import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import bcrypt from 'bcryptjs'
import pg from 'pg'

const { Client } = pg
const projectRoot = resolve(import.meta.dirname, '..')
const localEnvironment = resolve(projectRoot, '.env.local')
if (existsSync(localEnvironment)) process.loadEnvFile(localEnvironment)
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.')

const connection = new URL(process.env.DATABASE_URL)
if (connection.searchParams.get('sslmode') === 'require') connection.searchParams.set('sslmode', 'verify-full')
const client = new Client({ connectionString: connection.toString() })

await client.connect()
await client.query('begin')
try {
  const suffix = randomBytes(6).toString('hex')
  const passwordHash = await bcrypt.hash('Validacion123', 4)
  const user = await client.query(`
    insert into public.app_users (username, email, full_name, password_hash, password_changed_at)
    values ($1, $2, 'Administrador temporal', $3, now())
    returning id
  `, [`validate-${suffix}`, `validate-${suffix}@example.invalid`, passwordHash])
  const bootstrap = await client.query(
    'select * from public.bootstrap_business($1, $2, $3, $4)',
    [user.rows[0].id, `Validacion ${suffix}`, 'Casa Matriz', null],
  )
  const organizationId = bootstrap.rows[0].organization_id
  await client.query(`
    update public.organization_members
    set permissions = array['dashboard', 'settings', 'manageUsers']
    where organization_id = $1 and user_id = $2
  `, [organizationId, user.rows[0].id])
  const snapshot = await client.query(`
    insert into public.erp_state_snapshots (organization_id, state, updated_by)
    values ($1, $2::jsonb, $3)
    returning version, state
  `, [organizationId, JSON.stringify({ products: [], settings: { business: { name: 'Validación' } } }), user.rows[0].id])
  await client.query(`
    insert into public.user_sessions (user_id, organization_id, token_hash, expires_at)
    values ($1, $2, $3, now() + interval '1 hour')
  `, [user.rows[0].id, organizationId, randomBytes(32).toString('hex')])

  const access = await client.query(`
    select member.role, member.permissions, snapshot.version,
      jsonb_array_length(snapshot.state->'products') as product_count
    from public.organization_members member
    join public.erp_state_snapshots snapshot on snapshot.organization_id = member.organization_id
    where member.organization_id = $1 and member.user_id = $2
  `, [organizationId, user.rows[0].id])
  assert.equal(access.rows[0].role, 'admin')
  assert.ok(access.rows[0].permissions.includes('manageUsers'))
  assert.equal(Number(access.rows[0].version), 1)
  assert.equal(access.rows[0].product_count, 0)
  assert.equal(await bcrypt.compare('Validacion123', passwordHash), true)

  console.log('OK bootstrap, contraseña bcrypt, sesión y estado sincronizado')
  console.log('OK validación ejecutada dentro de una transacción reversible')
} finally {
  await client.query('rollback').catch(() => {})
  await client.end()
}

