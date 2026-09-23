import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import bcrypt from 'bcryptjs'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const projectRoot = resolve(import.meta.dirname, '..')
const localEnvironment = resolve(projectRoot, '.env.local')
if (existsSync(localEnvironment)) process.loadEnvFile(localEnvironment)

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL para conectar el servidor con Neon.')
}
if (process.env.VITE_DATABASE_URL) {
  throw new Error('No uses VITE_DATABASE_URL: expondria la credencial de Neon en el navegador.')
}

const connectionString = (() => {
  const connection = new URL(process.env.DATABASE_URL)
  if (connection.searchParams.get('sslmode') === 'require') connection.searchParams.set('sslmode', 'verify-full')
  return connection.toString()
})()

const pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_SIZE) || 10 })
const app = express()
const port = Number(process.env.PORT) || 5173
const sessionHours = Math.max(1, Number(process.env.SESSION_HOURS) || 12)
const sessionCookie = 'mf_session'

const permissionIds = [
  'dashboard', 'pos', 'inventory', 'receipts', 'dispatches', 'customers', 'suppliers', 'reports', 'settings',
  'editInventory', 'deleteHeldSales', 'exportReports', 'manageUsers',
]
const rolePermissions = {
  admin: permissionIds,
  seller: ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'exportReports'],
  warehouse: ['dashboard', 'inventory', 'receipts', 'dispatches', 'suppliers', 'editInventory'],
}
const roleLabels = { admin: 'Administrador', seller: 'Vendedor', warehouse: 'Bodeguero' }
const labelRoles = { Administrador: 'admin', Vendedor: 'seller', Bodeguero: 'warehouse' }
const stateKeys = new Set([
  'settings', 'products', 'customers', 'sales', 'receipts', 'dispatches', 'suppliers', 'heldSales', 'quotes', 'readNotifications',
])

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '10mb' }))

const asyncRoute = (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
const normalizeUsername = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '')
const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
const hashToken = (token) => createHash('sha256').update(token).digest('hex')

const passwordError = (password) => {
  if (String(password || '').length < 8) return 'La contrasena debe tener al menos 8 caracteres'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return 'Incluye una mayuscula, una minuscula y un numero'
  return ''
}

const cookies = (request) => Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => {
  const separator = part.indexOf('=')
  if (separator < 0) return ['', '']
  return [decodeURIComponent(part.slice(0, separator).trim()), decodeURIComponent(part.slice(separator + 1).trim())]
}).filter(([key]) => key))

const setSessionCookie = (response, token) => {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true'
  response.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`)
}

const clearSessionCookie = (response) => {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true'
  response.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`)
}

const withTransaction = async (work) => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

const validPermissions = (permissions, role) => {
  if (!Array.isArray(permissions)) return [...rolePermissions[role]]
  return [...new Set(permissions.filter((permission) => permissionIds.includes(permission)))]
}

const userDto = (row) => ({
  id: row.id,
  username: row.username,
  name: row.full_name,
  email: row.email || '',
  role: roleLabels[row.role] || 'Vendedor',
  active: row.user_active && row.member_active,
  permissions: row.permissions || rolePermissions[row.role] || [],
  hasPassword: row.password_algorithm === 'bcrypt',
  mustChangePassword: Boolean(row.must_change_password),
  lastLoginAt: row.last_login_at,
})

const listUsers = async (database, organizationId) => {
  const result = await database.query(`
    select app_user.id, app_user.username, app_user.email, app_user.full_name,
      app_user.password_algorithm, app_user.must_change_password, app_user.last_login_at,
      app_user.active as user_active, member.active as member_active, member.role, member.permissions
    from public.organization_members member
    join public.app_users app_user on app_user.id = member.user_id
    where member.organization_id = $1
    order by app_user.full_name, app_user.username
  `, [organizationId])
  return result.rows.map(userDto)
}

const createSession = async (database, response, userId, organizationId, request) => {
  const previousToken = cookies(request)[sessionCookie]
  if (previousToken) {
    await database.query('update public.user_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [hashToken(previousToken)])
  }
  const token = randomBytes(32).toString('base64url')
  await database.query(`
    insert into public.user_sessions (user_id, organization_id, token_hash, ip_address, user_agent, expires_at)
    values ($1, $2, $3, nullif($4, '')::inet, $5, now() + ($6 * interval '1 hour'))
  `, [userId, organizationId, hashToken(token), request.ip || '', request.get('user-agent') || '', sessionHours])
  setSessionCookie(response, token)
}

const loadSession = async (request) => {
  const token = cookies(request)[sessionCookie]
  if (!token) return null
  const result = await pool.query(`
    select session.id as session_id, session.user_id, session.organization_id, app_user.id,
      app_user.username, app_user.email, app_user.full_name, app_user.password_algorithm,
      app_user.must_change_password, app_user.last_login_at, app_user.active as user_active,
      member.active as member_active, member.role, member.permissions,
      organization.name as organization_name,
      branch.id as branch_id, branch.name as branch_name
    from public.user_sessions session
    join public.app_users app_user on app_user.id = session.user_id
    join public.organization_members member
      on member.user_id = session.user_id and member.organization_id = session.organization_id
    join public.organizations organization on organization.id = session.organization_id and organization.active
    left join lateral (
      select id, name from public.branches
      where organization_id = session.organization_id and active
      order by created_at limit 1
    ) branch on true
    where session.token_hash = $1
      and session.revoked_at is null
      and session.expires_at > now()
      and app_user.active and member.active
  `, [hashToken(token)])
  if (!result.rowCount) return null
  await pool.query('update public.user_sessions set last_seen_at = now() where id = $1', [result.rows[0].session_id])
  return result.rows[0]
}

const requireSession = ({ allowPasswordChange = false } = {}) => asyncRoute(async (request, response, next) => {
  const session = await loadSession(request)
  if (!session) {
    clearSessionCookie(response)
    return response.status(401).json({ error: 'Tu sesion vencio. Ingresa nuevamente.' })
  }
  if (session.must_change_password && !allowPasswordChange) {
    return response.status(428).json({ error: 'Debes cambiar tu contrasena antes de continuar.' })
  }
  request.auth = session
  next()
})

const requireUserAdmin = (request, response, next) => {
  const permissions = request.auth.permissions || rolePermissions[request.auth.role] || []
  if (request.auth.role !== 'admin' || !permissions.includes('manageUsers')) {
    return response.status(403).json({ error: 'No tienes permisos para administrar usuarios.' })
  }
  next()
}

const sanitizeState = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key]) => stateKeys.has(key)))
}

const appPayload = async (database, session) => {
  const [stateResult, users] = await Promise.all([
    database.query('select state, version from public.erp_state_snapshots where organization_id = $1', [session.organization_id]),
    listUsers(database, session.organization_id),
  ])
  return {
    user: userDto(session),
    users,
    state: stateResult.rows[0]?.state || {},
    version: Number(stateResult.rows[0]?.version || 0),
    organization: { id: session.organization_id, name: session.organization_name },
    branch: { id: session.branch_id, name: session.branch_name || 'Casa Matriz' },
  }
}

const loginAttempts = new Map()
const loginAllowed = (request, username) => {
  const key = `${request.ip}:${normalizeUsername(username)}`
  const now = Date.now()
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000)
  if (attempts.length >= 8) return false
  attempts.push(now)
  loginAttempts.set(key, attempts)
  return true
}
const clearLoginAttempts = (request, username) => loginAttempts.delete(`${request.ip}:${normalizeUsername(username)}`)

app.get('/api/health', asyncRoute(async (_request, response) => {
  await pool.query('select 1')
  response.json({ ok: true, database: 'connected' })
}))

app.get('/api/auth/status', asyncRoute(async (_request, response) => {
  const result = await pool.query(`
    select organization.name as business_name, branch.name as branch_name
    from public.organizations organization
    left join lateral (
      select name from public.branches where organization_id = organization.id and active order by created_at limit 1
    ) branch on true
    where organization.active
      and exists (select 1 from public.organization_members member where member.organization_id = organization.id and member.active)
    order by organization.created_at
    limit 1
  `)
  response.json({
    setupRequired: !result.rowCount,
    businessName: result.rows[0]?.business_name || 'Ferretería Los Nogales',
    branchName: result.rows[0]?.branch_name || 'Casa Matriz',
  })
}))

app.post('/api/auth/setup', asyncRoute(async (request, response) => {
  const username = normalizeUsername(request.body.username)
  const password = String(request.body.password || '')
  const validationError = passwordError(password)
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return response.status(400).json({ error: 'El usuario debe tener entre 3 y 30 caracteres validos.' })
  if (validationError) return response.status(400).json({ error: validationError })

  const payload = await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('erp-initial-setup'))")
    const initialized = await client.query('select 1 from public.organization_members where active limit 1')
    if (initialized.rowCount) {
      const conflict = new Error('El acceso inicial ya fue configurado.')
      conflict.status = 409
      throw conflict
    }
    const passwordHash = await bcrypt.hash(password, 12)
    const userResult = await client.query(`
      insert into public.app_users (username, email, full_name, password_hash, password_changed_at)
      values ($1, nullif($2, ''), $3, $4, now())
      returning id
    `, [username, normalizeEmail(request.body.email), String(request.body.name || 'Administrador').trim(), passwordHash])
    const bootstrap = await client.query('select * from public.bootstrap_business($1, $2, $3, $4)', [
      userResult.rows[0].id,
      String(request.body.businessName || 'Ferretería Los Nogales').trim(),
      String(request.body.branchName || 'Casa Matriz').trim(),
      null,
    ])
    const organizationId = bootstrap.rows[0].organization_id
    await client.query('update public.organization_members set permissions = $3 where organization_id = $1 and user_id = $2', [organizationId, userResult.rows[0].id, permissionIds])
    await client.query(`
      insert into public.erp_state_snapshots (organization_id, state, updated_by)
      values ($1, $2::jsonb, $3)
    `, [organizationId, JSON.stringify(sanitizeState(request.body.initialState)), userResult.rows[0].id])
    await client.query('update public.app_users set last_login_at = now() where id = $1', [userResult.rows[0].id])
    await createSession(client, response, userResult.rows[0].id, organizationId, request)
    const session = await loadSessionFromClient(client, userResult.rows[0].id, organizationId)
    return appPayload(client, session)
  })
  response.status(201).json(await payload)
}))

async function loadSessionFromClient(database, userId, organizationId) {
  const result = await database.query(`
    select app_user.id as user_id, app_user.id, app_user.username, app_user.email, app_user.full_name,
      app_user.password_algorithm, app_user.must_change_password, app_user.last_login_at,
      app_user.active as user_active, member.active as member_active, member.role, member.permissions,
      organization.id as organization_id, organization.name as organization_name,
      branch.id as branch_id, branch.name as branch_name
    from public.app_users app_user
    join public.organization_members member on member.user_id = app_user.id and member.organization_id = $2
    join public.organizations organization on organization.id = member.organization_id
    left join lateral (
      select id, name from public.branches where organization_id = organization.id and active order by created_at limit 1
    ) branch on true
    where app_user.id = $1
  `, [userId, organizationId])
  return result.rows[0]
}

app.post('/api/auth/login', asyncRoute(async (request, response) => {
  const login = String(request.body.username || '').trim()
  if (!loginAllowed(request, login)) return response.status(429).json({ error: 'Demasiados intentos. Espera unos minutos antes de continuar.' })
  const result = await pool.query(`
    select app_user.id, app_user.username, app_user.email, app_user.full_name, app_user.password_hash,
      app_user.password_algorithm, app_user.must_change_password, app_user.last_login_at,
      app_user.active as user_active, member.active as member_active, member.role, member.permissions,
      organization.id as organization_id, organization.name as organization_name,
      branch.id as branch_id, branch.name as branch_name
    from public.app_users app_user
    join public.organization_members member on member.user_id = app_user.id and member.active
    join public.organizations organization on organization.id = member.organization_id and organization.active
    left join lateral (
      select id, name from public.branches where organization_id = organization.id and active order by created_at limit 1
    ) branch on true
    where app_user.active and (lower(app_user.username) = lower($1) or lower(app_user.email) = lower($1))
    order by member.created_at
    limit 1
  `, [login])
  const user = result.rows[0]
  if (!user || user.password_algorithm !== 'bcrypt' || !await bcrypt.compare(String(request.body.password || ''), user.password_hash)) {
    return response.status(401).json({ error: 'Usuario o contrasena incorrectos.' })
  }
  clearLoginAttempts(request, login)
  await withTransaction(async (client) => {
    await client.query('update public.app_users set last_login_at = now() where id = $1', [user.id])
    await createSession(client, response, user.id, user.organization_id, request)
  })
  if (user.must_change_password) {
    return response.json({ requiresPasswordChange: true, userId: user.id, name: user.full_name })
  }
  const session = await loadSessionFromClient(pool, user.id, user.organization_id)
  response.json(await appPayload(pool, session))
}))

app.post('/api/auth/change-password', requireSession({ allowPasswordChange: true }), asyncRoute(async (request, response) => {
  const password = String(request.body.password || '')
  const validationError = passwordError(password)
  if (validationError) return response.status(400).json({ error: validationError })
  const passwordHash = await bcrypt.hash(password, 12)
  await pool.query(`
    update public.app_users
    set password_hash = $2, password_algorithm = 'bcrypt', must_change_password = false, password_changed_at = now()
    where id = $1
  `, [request.auth.user_id, passwordHash])
  const session = await loadSessionFromClient(pool, request.auth.user_id, request.auth.organization_id)
  response.json(await appPayload(pool, session))
}))

app.post('/api/auth/logout', requireSession({ allowPasswordChange: true }), asyncRoute(async (request, response) => {
  await pool.query('update public.user_sessions set revoked_at = now() where id = $1', [request.auth.session_id])
  clearSessionCookie(response)
  response.status(204).end()
}))

app.get('/api/state', requireSession(), asyncRoute(async (request, response) => {
  response.json(await appPayload(pool, request.auth))
}))

app.patch('/api/state', requireSession(), asyncRoute(async (request, response) => {
  const changes = sanitizeState(request.body.changes)
  if (!Object.keys(changes).length) return response.json({ ok: true })
  const result = await withTransaction(async (client) => {
    const stateResult = await client.query(`
      insert into public.erp_state_snapshots (organization_id, state, updated_by)
      values ($1, $2::jsonb, $3)
      on conflict (organization_id) do update
      set state = public.erp_state_snapshots.state || excluded.state,
          version = public.erp_state_snapshots.version + 1,
          updated_by = excluded.updated_by
      returning version, updated_at
    `, [request.auth.organization_id, JSON.stringify(changes), request.auth.user_id])
    if (changes.settings) {
      await client.query(`
        insert into public.organization_settings (organization_id, settings, updated_by)
        values ($1, $2::jsonb, $3)
        on conflict (organization_id) do update
        set settings = excluded.settings, updated_by = excluded.updated_by
      `, [request.auth.organization_id, JSON.stringify(changes.settings), request.auth.user_id])
      const business = changes.settings.business || {}
      const salesSettings = changes.settings.sales || {}
      await client.query(`
        update public.organizations
        set name = coalesce(nullif(trim($2), ''), name),
            legal_name = coalesce(nullif(trim($3), ''), legal_name),
            rut = nullif(trim($4), ''), email = nullif(trim($5), ''),
            phone = nullif(trim($6), ''), address = nullif(trim($7), '')
        where id = $1
      `, [request.auth.organization_id, business.name, business.legalName, business.rut, business.email, business.phone, business.address])
      await client.query(`
        update public.branches
        set name = coalesce(nullif(trim($3), ''), name),
            address = nullif(trim($4), ''), phone = nullif(trim($5), '')
        where organization_id = $1 and id = $2
      `, [request.auth.organization_id, request.auth.branch_id, business.branch, business.address, business.phone])
      await client.query(`
        update public.cash_registers
        set name = coalesce(nullif(trim($3), ''), name)
        where organization_id = $1 and branch_id = $2 and active
      `, [request.auth.organization_id, request.auth.branch_id, salesSettings.register])
    }
    return stateResult.rows[0]
  })
  response.json({ ok: true, version: Number(result.version), updatedAt: result.updated_at })
}))

app.post('/api/users', requireSession(), requireUserAdmin, asyncRoute(async (request, response) => {
  const username = normalizeUsername(request.body.username)
  const email = normalizeEmail(request.body.email)
  const name = String(request.body.name || '').trim()
  const role = labelRoles[request.body.role]
  const password = String(request.body.password || '')
  const validationError = passwordError(password)
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return response.status(400).json({ error: 'Nombre de usuario invalido.' })
  if (!name || !email || !role) return response.status(400).json({ error: 'Completa nombre, correo y rol.' })
  if (validationError) return response.status(400).json({ error: validationError })
  const permissions = validPermissions(request.body.permissions, role)
  const passwordHash = await bcrypt.hash(password, 12)
  await withTransaction(async (client) => {
    const created = await client.query(`
      insert into public.app_users (username, email, full_name, password_hash, must_change_password)
      values ($1, $2, $3, $4, true)
      returning id
    `, [username, email, name, passwordHash])
    await client.query(`
      insert into public.organization_members (organization_id, user_id, role, active, permissions)
      values ($1, $2, $3, $4, $5)
    `, [request.auth.organization_id, created.rows[0].id, role, request.body.active !== false, permissions])
    await client.query(`
      insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, new_data)
      values ($1, $2, 'create', 'user', $3, $4::jsonb)
    `, [request.auth.organization_id, request.auth.user_id, created.rows[0].id, JSON.stringify({ username, email, name, role })])
  })
  response.status(201).json({ users: await listUsers(pool, request.auth.organization_id) })
}))

app.patch('/api/users/:id', requireSession(), requireUserAdmin, asyncRoute(async (request, response) => {
  const userId = request.params.id
  const username = normalizeUsername(request.body.username)
  const email = normalizeEmail(request.body.email)
  const name = String(request.body.name || '').trim()
  const role = labelRoles[request.body.role]
  const permissions = validPermissions(request.body.permissions, role)
  const isSelf = userId === request.auth.user_id
  if (!/^[a-z0-9._-]{3,30}$/.test(username) || !name || !email || !role) return response.status(400).json({ error: 'Datos de usuario invalidos.' })
  if (isSelf && (request.body.active === false || role !== 'admin' || !permissions.includes('settings') || !permissions.includes('manageUsers'))) {
    return response.status(400).json({ error: 'Tu usuario debe conservar el acceso de administrador.' })
  }
  const password = String(request.body.password || '')
  const validationError = password ? passwordError(password) : ''
  if (validationError) return response.status(400).json({ error: validationError })
  await withTransaction(async (client) => {
    const passwordHash = password ? await bcrypt.hash(password, 12) : null
    const updated = await client.query(`
      update public.app_users
      set username = $2, email = $3, full_name = $4, active = $5,
          password_hash = coalesce($6, password_hash),
          must_change_password = case when $6::text is not null then $7 else must_change_password end,
          password_changed_at = case when $6::text is not null then now() else password_changed_at end
      where id = $1
      returning id
    `, [userId, username, email, name, request.body.active !== false, passwordHash, password ? !isSelf : false])
    if (!updated.rowCount) {
      const missing = new Error('El usuario no existe.')
      missing.status = 404
      throw missing
    }
    await client.query(`
      update public.organization_members
      set role = $3, active = $4, permissions = $5
      where organization_id = $1 and user_id = $2
    `, [request.auth.organization_id, userId, role, request.body.active !== false, permissions])
    if (password || request.body.active === false) {
      await client.query(`
        update public.user_sessions
        set revoked_at = now()
        where user_id = $1 and revoked_at is null and id <> $2
      `, [userId, request.auth.session_id])
    }
    await client.query(`
      insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, new_data)
      values ($1, $2, 'update', 'user', $3, $4::jsonb)
    `, [request.auth.organization_id, request.auth.user_id, userId, JSON.stringify({ username, email, name, role, active: request.body.active !== false })])
  })
  response.json({ users: await listUsers(pool, request.auth.organization_id) })
}))

app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint inexistente.' }))

if (process.env.NODE_ENV === 'production') {
  const distribution = resolve(projectRoot, 'dist')
  app.use(express.static(distribution, { index: false }))
  app.use((_request, response) => response.sendFile(resolve(distribution, 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}

app.use((error, _request, response, _next) => {
  const duplicate = error.code === '23505'
  const message = duplicate
    ? 'Ya existe un registro con ese usuario o correo.'
    : error.status && error.message
      ? error.message
      : 'No fue posible completar la operacion en el servidor.'
  if (!error.status && !duplicate) console.error(error)
  response.status(error.status || (duplicate ? 409 : 500)).json({ error: message })
})

const server = app.listen(port, () => console.log(`ERP disponible en http://localhost:${port}`))

const shutdown = async () => {
  server.close()
  await pool.end().catch(() => {})
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
