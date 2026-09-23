import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg
const projectRoot = resolve(import.meta.dirname, '..')
const migrationsDirectory = resolve(projectRoot, 'neon', 'migrations')

const localEnvironment = resolve(projectRoot, '.env.local')
if (existsSync(localEnvironment)) process.loadEnvFile(localEnvironment)

const databaseUrl = process.env.DATABASE_URL
const command = process.argv[2] || 'verify'

if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL. Copia .env.example a .env.local y agrega la conexión de Neon.')
}

if (process.env.VITE_DATABASE_URL) {
  throw new Error('No uses VITE_DATABASE_URL: Vite expondría la credencial de PostgreSQL en el navegador.')
}

const targetLabel = (() => {
  try {
    const target = new URL(databaseUrl)
    return `${target.hostname}/${target.pathname.replace(/^\//, '')}`
  } catch {
    return 'destino configurado'
  }
})()

// node-postgres currently verifies Neon certificates for sslmode=require, but
// its next major version will change that alias. Preserve strict verification.
const clientConnectionString = (() => {
  try {
    const connection = new URL(databaseUrl)
    if (connection.searchParams.get('sslmode') === 'require') {
      connection.searchParams.set('sslmode', 'verify-full')
    }
    return connection.toString()
  } catch {
    return databaseUrl
  }
})()

const client = new Client({ connectionString: clientConnectionString })

async function ensureMigrationTable() {
  await client.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `)
}

async function migrate() {
  await ensureMigrationTable()

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))

  if (!migrationFiles.length) throw new Error('No se encontraron migraciones SQL.')

  for (const fileName of migrationFiles) {
    const sql = readFileSync(resolve(migrationsDirectory, fileName), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const current = await client.query(
      'select checksum from public.schema_migrations where name = $1',
      [fileName],
    )

    if (current.rowCount) {
      if (current.rows[0].checksum !== checksum) {
        throw new Error(`La migración aplicada ${fileName} fue modificada. Crea una migración nueva.`)
      }
      console.log(`= ${fileName} ya aplicada`)
      continue
    }

    await client.query('begin')
    try {
      await client.query(sql)
      await client.query(
        'insert into public.schema_migrations (name, checksum) values ($1, $2)',
        [fileName, checksum],
      )
      await client.query('commit')
      console.log(`+ ${fileName} aplicada`)
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }
}

const expectedTables = [
  'app_users',
  'audit_logs',
  'branch_inventory',
  'branches',
  'cash_movements',
  'cash_registers',
  'cash_sessions',
  'customers',
  'dispatch_items',
  'dispatches',
  'document_sequences',
  'erp_state_snapshots',
  'held_sale_items',
  'held_sales',
  'import_batch_errors',
  'import_batches',
  'inventory_receipt_items',
  'inventory_receipts',
  'organization_members',
  'organization_settings',
  'organizations',
  'product_categories',
  'products',
  'quote_items',
  'quotes',
  'sale_items',
  'sale_payments',
  'sale_return_items',
  'sale_returns',
  'sales',
  'stock_movements',
  'user_notification_reads',
  'user_sessions',
  'suppliers',
]

const expectedFunctions = [
  'adjust_inventory',
  'bootstrap_business',
  'has_org_role',
  'next_document_folio',
  'protect_last_admin',
  'set_updated_at',
]

const expectedViews = ['inventory_valuation', 'product_stock']

async function verify() {
  const tableResult = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `)
  const functionResult = await client.query(`
    select distinct routine_name
    from information_schema.routines
    where routine_schema = 'public'
  `)
  const viewResult = await client.query(`
    select table_name
    from information_schema.views
    where table_schema = 'public'
  `)
  const migrationResult = await client.query(`
    select name, applied_at
    from public.schema_migrations
    order by name
  `)

  const presentTables = new Set(tableResult.rows.map((row) => row.table_name))
  const presentFunctions = new Set(functionResult.rows.map((row) => row.routine_name))
  const presentViews = new Set(viewResult.rows.map((row) => row.table_name))
  const missingTables = expectedTables.filter((name) => !presentTables.has(name))
  const missingFunctions = expectedFunctions.filter((name) => !presentFunctions.has(name))
  const missingViews = expectedViews.filter((name) => !presentViews.has(name))

  if (missingTables.length || missingFunctions.length || missingViews.length) {
    throw new Error([
      missingTables.length ? `Tablas faltantes: ${missingTables.join(', ')}` : '',
      missingFunctions.length ? `Funciones faltantes: ${missingFunctions.join(', ')}` : '',
      missingViews.length ? `Vistas faltantes: ${missingViews.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
  }

  console.log(`OK ${expectedTables.length} tablas ERP`)
  console.log(`OK ${expectedFunctions.length} funciones`)
  console.log(`OK ${expectedViews.length} vistas`)
  console.log(`OK ${migrationResult.rowCount} migración(es) registrada(s)`)
}

try {
  console.log(`Neon: ${targetLabel}`)
  await client.connect()

  if (command === 'migrate') {
    await migrate()
    await verify()
  } else if (command === 'verify') {
    await verify()
  } else {
    throw new Error(`Comando desconocido: ${command}. Usa migrate o verify.`)
  }
} finally {
  await client.end().catch(() => {})
}
