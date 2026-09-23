import { useEffect, useMemo, useRef, useState } from 'react'
import bcrypt from 'bcryptjs'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Box,
  Boxes,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileText,
  FileSpreadsheet,
  Globe2,
  Hammer,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  Settings,
  ShoppingCart,
  ShieldCheck,
  Star,
  Trash2,
  Truck,
  Upload,
  UserRound,
  Users,
  Warehouse,
  X,
} from 'lucide-react'
import { createInitialLoadSheets, initialLoadTemplates, mergeInitialLoad, parseInitialLoadWorkbook } from './initialLoad'

const money = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
})

const number = new Intl.NumberFormat('es-CL')

const localDateKey = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getSaleDate = (sale) => sale.date || localDateKey()
const getSalePayment = (sale) => sale.payment || 'Débito'

const getSaleTimestamp = (sale) => {
  if (sale.createdAt) {
    const timestamp = Date.parse(sale.createdAt)
    if (!Number.isNaN(timestamp)) return timestamp
  }
  const [year, month, day] = getSaleDate(sale).split('-').map(Number)
  const normalizedTime = String(sale.time || '00:00').toLowerCase().replace(/\s/g, '')
  const match = normalizedTime.match(/(\d{1,2}):(\d{2})/)
  let hour = match ? Number(match[1]) : 0
  const minute = match ? Number(match[2]) : 0
  if (/p\.?m\.?/.test(normalizedTime) && hour < 12) hour += 12
  if (/a\.?m\.?/.test(normalizedTime) && hour === 12) hour = 0
  return new Date(year, month - 1, day, hour, minute).getTime()
}

const printDocument = (type) => {
  const className = `printing-${type}`
  const cleanup = () => document.body.classList.remove(className)
  document.body.classList.add(className)
  window.addEventListener('afterprint', cleanup, { once: true })
  window.print()
  window.setTimeout(cleanup, 1000)
}

const storeInfo = {
  name: 'Ferretería Los Nogales',
  rut: '76.482.190-6',
  address: 'Av. Matta 845, Santiago Centro',
  phone: '+56 2 2345 6789',
  branch: 'Casa Matriz',
}

const defaultSettings = {
  business: {
    ...storeInfo,
    legalName: 'Ferretería Los Nogales SpA',
    email: 'contacto@ferreterialosnogales.cl',
  },
  sales: {
    register: 'Caja 01',
    cashier: 'Matías Dintrans',
    defaultPayment: 'Débito',
    paymentMethods: ['Efectivo', 'Débito', 'Crédito', 'Transferencia'],
  },
  documents: {
    saleSequence: 1,
    quoteSequence: 1,
    quoteValidityDays: 15,
    receiptFormat: 'Térmica 80 mm',
    receiptFooter: 'Conserve esta boleta para cambios o devoluciones.',
    quoteFooter: 'Gracias por cotizar con nosotros',
  },
  inventory: {
    lowStockAlerts: true,
    preventNegative: true,
    defaultMinStock: 5,
    categories: 'Herramientas, Accesorios, Fijaciones, Pinturas, Adhesivos, Seguridad, Electricidad, Gasfitería',
    units: 'un, caja, par, tira, galón, metro',
  },
  notifications: {
    lowStock: true,
    pendingDispatches: true,
    expiringQuotes: true,
    quoteWarningDays: 5,
    dailySalesSummary: true,
  },
}

const normalizeSettings = (value = {}) => ({
  ...defaultSettings,
  ...value,
  business: { ...defaultSettings.business, ...value.business },
  sales: { ...defaultSettings.sales, ...value.sales },
  documents: { ...defaultSettings.documents, ...value.documents },
  inventory: { ...defaultSettings.inventory, ...value.inventory },
  notifications: { ...defaultSettings.notifications, ...value.notifications },
})

const splitList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
const isLowStock = (product, settings) => settings.inventory.lowStockAlerts && product.stock <= (product.minStock ?? settings.inventory.defaultMinStock)

const defaultProducts = []
const defaultCustomers = []
const defaultHeldSales = []
const initialSales = []
const initialReceipts = []
const initialDispatches = []
const defaultSuppliers = []

const EMPTY_DATA_VERSION = 'empty-operational-data-v1'
const operationalStorageKeys = [
  'mf-products',
  'mf-customers',
  'mf-sales',
  'mf-receipts',
  'mf-dispatches',
  'mf-suppliers',
  'mf-held-sales',
  'mf-quotes',
  'mf-settings',
  'mf-users',
  'mf-current-user',
  'mf-read-notifications',
  'mf-quote-sequence',
  'mf-held-sale-sequence',
]

const resetLegacyOperationalData = () => {
  try {
    if (localStorage.getItem('mf-data-version') === EMPTY_DATA_VERSION) return
    operationalStorageKeys.forEach((key) => localStorage.removeItem(key))
    localStorage.setItem('mf-data-version', EMPTY_DATA_VERSION)
  } catch {
    // The in-memory empty defaults still apply if storage is unavailable.
  }
}

const navItems = [
  { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
  { id: 'pos', label: 'Punto de venta', icon: ShoppingCart },
  { id: 'inventory', label: 'Inventario', icon: Boxes },
  { id: 'receipts', label: 'Ingresos', icon: ArrowDownToLine },
  { id: 'dispatches', label: 'Despachos', icon: Truck },
  { id: 'customers', label: 'Clientes', icon: Users },
  { id: 'suppliers', label: 'Proveedores', icon: Building2 },
  { id: 'reports', label: 'Reportes', icon: BarChart3 },
]

const modulePermissions = [
  { id: 'dashboard', label: 'Resumen' },
  { id: 'pos', label: 'Punto de venta' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'receipts', label: 'Ingresos' },
  { id: 'dispatches', label: 'Despachos' },
  { id: 'customers', label: 'Clientes' },
  { id: 'suppliers', label: 'Proveedores' },
  { id: 'reports', label: 'Reportes' },
  { id: 'settings', label: 'Configuración' },
]

const actionPermissions = [
  { id: 'editInventory', label: 'Crear y editar productos' },
  { id: 'deleteHeldSales', label: 'Eliminar ventas en espera' },
  { id: 'exportReports', label: 'Exportar reportes' },
  { id: 'manageUsers', label: 'Administrar usuarios' },
]

const allPermissionIds = [...modulePermissions, ...actionPermissions].map((permission) => permission.id)
const rolePermissions = {
  Administrador: allPermissionIds,
  Vendedor: ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'exportReports'],
  Bodeguero: ['dashboard', 'inventory', 'receipts', 'dispatches', 'suppliers', 'editInventory'],
}

const defaultUsers = [
  { id: 1, username: 'matias', name: 'Matías Dintrans', email: 'matias@ferreterialosnogales.cl', role: 'Administrador', active: true, permissions: rolePermissions.Administrador },
]

const userInitials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'US'
const userCan = (user, permission) => Boolean(user?.active && user.permissions?.includes(permission))

const PASSWORD_ITERATIONS = 210000
const normalizeEmail = (email) => String(email || '').trim().toLowerCase()
const normalizeUsername = (username) => String(username || '').trim().toLowerCase().replace(/\s+/g, '')
const normalizeSearchValue = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const getUsername = (user) => normalizeUsername(user?.username || normalizeEmail(user?.email).split('@')[0] || `usuario${user?.id || ''}`)
const hasPasswordCredential = (user) => Boolean(user?.passwordHash && (user.passwordVersion === 2 || user.passwordSalt))
const normalizeUsers = (value) => (Array.isArray(value) && value.length ? value : defaultUsers).map((user) => ({ ...user, username: getUsername(user) }))

const passwordValidationMessage = (password) => {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return 'Incluye una mayúscula, una minúscula y un número'
  return ''
}

const base64ToBytes = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

const derivePasswordHash = async (password, salt) => {
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const result = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  )
  return new Uint8Array(result)
}

const createPasswordCredential = async (password) => {
  const passwordHash = await bcrypt.hash(password, 10)
  return { passwordSalt: null, passwordHash, passwordVersion: 2 }
}

const verifyPassword = async (password, user) => {
  if (!hasPasswordCredential(user)) return false
  try {
    if (user.passwordVersion === 2 || user.passwordHash.startsWith('$2')) return await bcrypt.compare(password, user.passwordHash)
    if (!globalThis.crypto?.subtle || !user.passwordSalt) return false
    const expected = base64ToBytes(user.passwordHash)
    const actual = await derivePasswordHash(password, base64ToBytes(user.passwordSalt))
    if (expected.length !== actual.length) return false
    let difference = 0
    expected.forEach((value, index) => { difference |= value ^ actual[index] })
    return difference === 0
  } catch {
    return false
  }
}

function usePersistedState(key, fallback, normalize = (value) => value) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved ? normalize(JSON.parse(saved)) : fallback
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state))
  }, [key, state])

  return [state, setState]
}

function App() {
  resetLegacyOperationalData()
  const [activeView, setActiveView] = useState('dashboard')
  const [products, setProducts] = usePersistedState('mf-products', defaultProducts)
  const [customers, setCustomers] = usePersistedState('mf-customers', defaultCustomers)
  const [sales, setSales] = usePersistedState('mf-sales', initialSales)
  const [receipts, setReceipts] = usePersistedState('mf-receipts', initialReceipts)
  const [dispatches, setDispatches] = usePersistedState('mf-dispatches', initialDispatches)
  const [suppliers, setSuppliers] = usePersistedState('mf-suppliers', defaultSuppliers)
  const [heldSales, setHeldSales] = usePersistedState('mf-held-sales', defaultHeldSales)
  const [quotes, setQuotes] = usePersistedState('mf-quotes', [])
  const [settings, setSettings] = usePersistedState('mf-settings', defaultSettings, normalizeSettings)
  const [users, setUsers] = usePersistedState('mf-users', defaultUsers, normalizeUsers)
  const [currentUserId, setCurrentUserId] = usePersistedState('mf-current-user', 1)
  const [sessionUserId, setSessionUserId] = useState(null)
  const [readNotifications, setReadNotifications] = usePersistedState('mf-read-notifications', {})
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState('business')
  const [globalQuery, setGlobalQuery] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [moduleSearch, setModuleSearch] = useState({ view: null, query: '', id: null })
  const globalSearchInputRef = useRef(null)
  const globalSearchRef = useRef(null)
  const authenticatedUser = users.find((user) => String(user.id) === String(sessionUserId) && user.active) || null
  const currentUser = authenticatedUser || users.find((user) => user.active) || defaultUsers[0]
  const setupRequired = !users.some((user) => user.active && hasPasswordCredential(user))
  const initialAdminUsername = getUsername(users.find((user) => user.active && user.role === 'Administrador') || defaultUsers[0])
  const can = (permission) => userCan(currentUser, permission)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!authenticatedUser) return
    const handleGlobalSearchShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        globalSearchInputRef.current?.focus()
        setGlobalSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setGlobalSearchOpen(false)
        globalSearchInputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleGlobalSearchShortcut)
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut)
  }, [authenticatedUser?.id])

  useEffect(() => {
    const closeGlobalSearch = (event) => {
      if (!globalSearchRef.current?.contains(event.target)) setGlobalSearchOpen(false)
    }
    document.addEventListener('mousedown', closeGlobalSearch)
    return () => document.removeEventListener('mousedown', closeGlobalSearch)
  }, [])

  useEffect(() => {
    if (can(activeView)) return
    const fallback = navItems.find((item) => can(item.id))?.id || 'dashboard'
    setActiveView(fallback)
  }, [activeView, currentUserId, users])

  const navigate = (view, search = null) => {
    if (!can(view)) {
      setToast({ message: 'Tu perfil no tiene acceso a este módulo', tone: 'warning' })
      return
    }
    setModuleSearch(search ? { view, query: search.query || '', id: search.id || null } : { view: null, query: '', id: null })
    setActiveView(view)
    setSidebarOpen(false)
    setNotificationOpen(false)
    setAccountOpen(false)
    setGlobalSearchOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const notify = (message, tone = 'success') => setToast({ message, tone })

  const establishAuthSession = (user) => {
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, lastLoginAt: new Date().toISOString() } : item))
    setCurrentUserId(user.id)
    setSessionUserId(user.id)
  }

  const loginWithPassword = async (username, password) => {
    const normalizedLogin = normalizeUsername(username)
    const user = users.find((item) => item.active && (getUsername(item) === normalizedLogin || normalizeEmail(item.email) === normalizeEmail(username)))
    if (!user || !await verifyPassword(password, user)) return { error: 'Usuario o contraseña incorrectos' }
    if (user.mustChangePassword) return { requiresPasswordChange: true, userId: user.id, name: user.name }
    establishAuthSession(user)
    return { success: true }
  }

  const initializeAdminAccess = async (username, password) => {
    if (!setupRequired) return { error: 'El acceso inicial ya fue configurado' }
    const validationError = passwordValidationMessage(password)
    if (validationError) return { error: validationError }
    const normalizedLogin = normalizeUsername(username)
    const admin = users.find((user) => user.active && user.role === 'Administrador' && (getUsername(user) === normalizedLogin || normalizeEmail(user.email) === normalizeEmail(username)))
    if (!admin) return { error: 'El usuario no corresponde a un administrador activo' }
    const credential = await createPasswordCredential(password)
    const initializedAdmin = { ...admin, ...credential, mustChangePassword: false }
    setUsers((current) => current.map((user) => user.id === admin.id ? initializedAdmin : user))
    establishAuthSession(initializedAdmin)
    return { success: true }
  }

  const completeInitialPasswordChange = async (userId, password) => {
    const validationError = passwordValidationMessage(password)
    if (validationError) return { error: validationError }
    const user = users.find((item) => item.id === userId && item.active)
    if (!user) return { error: 'La cuenta ya no se encuentra disponible' }
    const credential = await createPasswordCredential(password)
    const updatedUser = { ...user, ...credential, mustChangePassword: false }
    setUsers((current) => current.map((item) => item.id === user.id ? updatedUser : item))
    establishAuthSession(updatedUser)
    return { success: true }
  }

  const logout = () => {
    setSessionUserId(null)
    setAccountOpen(false)
    setNotificationOpen(false)
    setSidebarOpen(false)
  }

  const viewTitle = activeView === 'settings' ? 'Configuración' : navItems.find((item) => item.id === activeView)?.label || settings.business.name
  const lowStockCount = products.filter((product) => product.stock <= (product.minStock ?? settings.inventory.defaultMinStock)).length
  const mobileNavItems = navItems.slice(0, 5).filter(({ id }) => can(id))
  const notifications = useMemo(() => {
    const items = []
    const pendingDispatches = dispatches.filter((item) => item.status === 'Preparando')
    const todaySales = sales.filter((sale) => getSaleDate(sale) === localDateKey())
    const warningDays = Math.max(1, Number(settings.notifications.quoteWarningDays) || 1)
    const todayStart = new Date(`${localDateKey()}T00:00:00`).getTime()
    const expiringQuotes = quotes.filter((quote) => {
      const days = Math.ceil((new Date(`${quote.validUntil}T23:59:59`).getTime() - todayStart) / 86400000)
      return days >= 0 && days <= warningDays
    })
    if (settings.notifications.lowStock && lowStockCount) items.push({ id: `stock-${lowStockCount}`, title: 'Stock crítico', detail: `${lowStockCount} productos requieren reposición.`, target: 'inventory', icon: AlertTriangle, tone: 'warning' })
    if (settings.notifications.pendingDispatches && pendingDispatches.length) items.push({ id: `dispatch-${pendingDispatches.length}`, title: 'Despachos pendientes', detail: `${pendingDispatches.length} pedidos están en preparación.`, target: 'dispatches', icon: Truck, tone: 'blue' })
    if (settings.notifications.expiringQuotes && expiringQuotes.length) items.push({ id: `quotes-${expiringQuotes.map((quote) => quote.id).join('-')}`, title: 'Cotizaciones por vencer', detail: `${expiringQuotes.length} cotizaciones vencen dentro de ${warningDays} días.`, target: 'pos', icon: FileText, tone: 'amber' })
    if (settings.notifications.dailySalesSummary && todaySales.length) {
      const total = todaySales.reduce((sum, sale) => sum + sale.total, 0)
      items.push({ id: `sales-${localDateKey()}-${todaySales.length}-${total}`, title: 'Resumen de ventas', detail: `${todaySales.length} ventas registradas por ${money.format(total)}.`, target: 'dashboard', icon: CircleDollarSign, tone: 'success' })
    }
    return items.filter((item) => can(item.target))
  }, [dispatches, lowStockCount, quotes, sales, settings.notifications, currentUserId, users])
  const readForCurrentUser = readNotifications[currentUser.id] || []
  const unreadNotifications = notifications.filter((item) => !readForCurrentUser.includes(item.id))
  const globalSearchResults = useMemo(() => {
    const query = normalizeSearchValue(globalQuery)
    if (!query) return { products: [], documents: [] }

    const productResults = can('inventory') ? products
      .filter((product) => normalizeSearchValue(`${product.name} ${product.sku} ${product.brand} ${product.category}`).includes(query))
      .sort((left, right) => {
        const leftStarts = normalizeSearchValue(`${left.sku} ${left.name}`).startsWith(query) ? 0 : 1
        const rightStarts = normalizeSearchValue(`${right.sku} ${right.name}`).startsWith(query) ? 0 : 1
        return leftStarts - rightStarts || left.name.localeCompare(right.name, 'es')
      })
      .slice(0, 4)
      .map((product) => ({
        key: `product-${product.id}`,
        icon: Hammer,
        tone: 'product',
        type: 'Producto',
        title: product.name,
        detail: `${product.sku} · ${product.stock} ${product.unit} disponibles`,
        target: 'inventory',
        query: product.sku,
        recordId: product.id,
      })) : []

    const documentResults = [
      ...sales.map((sale) => ({
        key: `sale-${sale.id}`,
        icon: ReceiptText,
        tone: 'sale',
        type: 'Venta',
        title: sale.id,
        detail: `${sale.customer} · ${money.format(sale.total)}`,
        searchable: `${sale.id} ${sale.customer} ${sale.seller} ${sale.payment}`,
        target: 'reports',
        query: sale.id,
        recordId: sale.id,
      })),
      ...receipts.map((receipt) => ({
        key: `receipt-${receipt.id}`,
        icon: ArrowDownToLine,
        tone: 'receipt',
        type: 'Ingreso',
        title: receipt.id,
        detail: `${receipt.supplier} · ${receipt.document}`,
        searchable: `${receipt.id} ${receipt.supplier} ${receipt.document} ${receipt.responsible}`,
        target: 'receipts',
        query: receipt.id,
        recordId: receipt.id,
      })),
      ...dispatches.map((dispatch) => ({
        key: `dispatch-${dispatch.id}`,
        icon: Truck,
        tone: 'dispatch',
        type: 'Despacho',
        title: dispatch.id,
        detail: `${dispatch.customer} · ${dispatch.status}`,
        searchable: `${dispatch.id} ${dispatch.customer} ${dispatch.contact} ${dispatch.address} ${dispatch.order} ${dispatch.status}`,
        target: 'dispatches',
        query: dispatch.id,
        recordId: dispatch.id,
      })),
      ...quotes.map((quote) => ({
        key: `quote-${quote.id}`,
        icon: FileText,
        tone: 'quote',
        type: 'Cotización',
        title: quote.id,
        detail: `${quote.customer} · ${money.format(quote.total)}`,
        searchable: `${quote.id} ${quote.customer} ${quote.seller}`,
        target: 'pos',
        query: quote.id,
        recordId: quote.id,
      })),
    ]
      .filter((result) => can(result.target) && normalizeSearchValue(result.searchable).includes(query))
      .slice(0, 6)

    return { products: productResults, documents: documentResults }
  }, [globalQuery, products, sales, receipts, dispatches, quotes, currentUser.id, users])
  const flattenedSearchResults = [...globalSearchResults.products, ...globalSearchResults.documents]

  const openGlobalSearchResult = (result) => {
    setGlobalQuery('')
    navigate(result.target, { query: result.query, id: result.recordId })
  }

  const handleGlobalSearchKeyDown = (event) => {
    if (event.key === 'Enter' && flattenedSearchResults[0]) {
      event.preventDefault()
      openGlobalSearchResult(flattenedSearchResults[0])
    }
  }

  const markNotificationRead = (id) => setReadNotifications((current) => ({
    ...current,
    [currentUser.id]: [...new Set([...(current[currentUser.id] || []), id])],
  }))

  const openNotification = (notification) => {
    markNotificationRead(notification.id)
    navigate(notification.target)
  }

  const markAllNotificationsRead = () => setReadNotifications((current) => ({
    ...current,
    [currentUser.id]: [...new Set([...(current[currentUser.id] || []), ...notifications.map((item) => item.id)])],
  }))

  if (!authenticatedUser) {
    return <LoginScreen
      businessName={settings.business.name}
      branchName={settings.business.branch}
      setupRequired={setupRequired}
      initialUsername={initialAdminUsername}
      onLogin={loginWithPassword}
      onSetup={initializeAdminAccess}
      onCompletePasswordChange={completeInitialPasswordChange}
    />
  }

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} navigate={navigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} settings={settings} products={products} currentUser={currentUser} />

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú">
              <Menu size={20} />
            </button>
            <div>
              <span className="topbar-kicker">{settings.business.branch} · {settings.business.address}</span>
              <h1>{viewTitle}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div className={`header-search ${globalSearchOpen ? 'open' : ''}`} ref={globalSearchRef}>
              <Search size={17} />
              <input ref={globalSearchInputRef} value={globalQuery} onChange={(event) => { setGlobalQuery(event.target.value); setGlobalSearchOpen(true) }} onFocus={() => setGlobalSearchOpen(true)} onKeyDown={handleGlobalSearchKeyDown} placeholder="Buscar producto o documento" aria-label="Buscar producto o documento" autoComplete="off" />
              {globalQuery ? <button type="button" className="global-search-clear" onClick={() => { setGlobalQuery(''); globalSearchInputRef.current?.focus() }} aria-label="Limpiar búsqueda"><X size={15} /></button> : <kbd>Ctrl K</kbd>}
              {globalSearchOpen && <div className="global-search-panel">
                {!globalQuery.trim() ? <div className="global-search-empty"><Search size={21} /><span><strong>Búsqueda global</strong><small>Escribe un nombre, SKU, folio, cliente o documento.</small></span></div> : !flattenedSearchResults.length ? <div className="global-search-empty"><Search size={21} /><span><strong>Sin coincidencias</strong><small>No encontramos productos ni documentos para “{globalQuery}”.</small></span></div> : <div className="global-search-results">
                  {!!globalSearchResults.products.length && <section><h4>Productos</h4>{globalSearchResults.products.map((result) => {
                    const Icon = result.icon
                    return <button type="button" key={result.key} onClick={() => openGlobalSearchResult(result)}><span className={`global-result-icon ${result.tone}`}><Icon size={17} /></span><span><small>{result.type}</small><strong>{result.title}</strong><em>{result.detail}</em></span><ArrowRight size={15} /></button>
                  })}</section>}
                  {!!globalSearchResults.documents.length && <section><h4>Documentos</h4>{globalSearchResults.documents.map((result) => {
                    const Icon = result.icon
                    return <button type="button" key={result.key} onClick={() => openGlobalSearchResult(result)}><span className={`global-result-icon ${result.tone}`}><Icon size={17} /></span><span><small>{result.type}</small><strong>{result.title}</strong><em>{result.detail}</em></span><ArrowRight size={15} /></button>
                  })}</section>}
                </div>}
                <div className="global-search-footer"><span><kbd>Enter</kbd> abrir primer resultado</span><span><kbd>Esc</kbd> cerrar</span></div>
              </div>}
            </div>
            <div className="notification-wrap">
              <button className="icon-button notification-button" onClick={() => setNotificationOpen((value) => !value)} aria-label="Notificaciones">
                <Bell size={19} />
                {!!unreadNotifications.length && <span className="notification-count">{unreadNotifications.length > 9 ? '9+' : unreadNotifications.length}</span>}
              </button>
              {notificationOpen && (
                <div className="notification-panel">
                  <div className="popover-title"><span><strong>Notificaciones</strong><small>{unreadNotifications.length} sin leer</small></span>{!!unreadNotifications.length && <button onClick={markAllNotificationsRead}>Marcar todas</button>}</div>
                  <div className="notification-list">{notifications.length ? notifications.map((notification) => {
                    const Icon = notification.icon
                    const isRead = readForCurrentUser.includes(notification.id)
                    return <button key={notification.id} className={isRead ? 'read' : ''} onClick={() => openNotification(notification)}><span className={`notification-icon ${notification.tone}`}><Icon size={17} /></span><span><strong>{notification.title}</strong><small>{notification.detail}</small></span>{!isRead && <i />}</button>
                  }) : <div className="notification-empty"><Check size={18} /><span><strong>Todo al día</strong><small>No tienes alertas activas.</small></span></div>}</div>
                  {can('settings') && <button className="notification-settings" onClick={() => { setSettingsSection('notifications'); navigate('settings') }}><Settings size={14} />Configurar notificaciones</button>}
                </div>
              )}
            </div>
            <div className="user-menu-wrap">
              <button className="user-chip" onClick={() => { setAccountOpen((value) => !value); setNotificationOpen(false) }} aria-label="Abrir menú de usuario">
                <span className="avatar">{userInitials(currentUser.name)}</span>
                <span className="user-copy"><strong>{currentUser.name.split(' ')[0]}</strong><small>{currentUser.role}</small></span>
                <ChevronDown size={15} />
              </button>
              {accountOpen && <div className="user-menu">
                <div className="user-menu-heading"><strong>{currentUser.name}</strong><small>{currentUser.email}</small><span>{currentUser.role}</span></div>
                <button className="user-menu-logout" type="button" onClick={logout}><LogOut size={17} /><span><strong>Cerrar sesión</strong><small>Salir de forma segura</small></span><ArrowRight size={15} /></button>
              </div>}
            </div>
          </div>
        </header>

        <main className={`page-content page-${activeView}`}>
          {activeView === 'dashboard' && <Dashboard products={products} sales={sales} receipts={receipts} dispatches={dispatches} navigate={navigate} settings={settings} currentUser={currentUser} />}
          {activeView === 'pos' && <PointOfSale products={products} setProducts={setProducts} customers={customers} sales={sales} setSales={setSales} heldSales={heldSales} setHeldSales={setHeldSales} quotes={quotes} setQuotes={setQuotes} notify={notify} settings={settings} setSettings={setSettings} currentUser={currentUser} can={can} initialQuoteId={moduleSearch.view === 'pos' ? moduleSearch.id : null} />}
          {activeView === 'inventory' && <Inventory products={products} setProducts={setProducts} notify={notify} settings={settings} currentUser={currentUser} can={can} initialQuery={moduleSearch.view === 'inventory' ? moduleSearch.query : ''} />}
          {activeView === 'receipts' && <Receipts products={products} setProducts={setProducts} receipts={receipts} setReceipts={setReceipts} suppliers={suppliers} notify={notify} currentUser={currentUser} highlightId={moduleSearch.view === 'receipts' ? moduleSearch.id : null} />}
          {activeView === 'dispatches' && <Dispatches products={products} setProducts={setProducts} customers={customers} dispatches={dispatches} setDispatches={setDispatches} notify={notify} settings={settings} currentUser={currentUser} highlightId={moduleSearch.view === 'dispatches' ? moduleSearch.id : null} />}
          {activeView === 'customers' && <Customers customers={customers} sales={sales} />}
          {activeView === 'suppliers' && <Suppliers suppliers={suppliers} setSuppliers={setSuppliers} notify={notify} currentUser={currentUser} />}
          {activeView === 'reports' && <Reports products={products} sales={sales} notify={notify} settings={settings} can={can} initialQuery={moduleSearch.view === 'reports' ? moduleSearch.query : ''} />}
          {activeView === 'settings' && <Configuration settings={settings} setSettings={setSettings} products={products} setProducts={setProducts} customers={customers} setCustomers={setCustomers} sales={sales} setSales={setSales} receipts={receipts} setReceipts={setReceipts} dispatches={dispatches} setDispatches={setDispatches} suppliers={suppliers} setSuppliers={setSuppliers} heldSales={heldSales} setHeldSales={setHeldSales} quotes={quotes} setQuotes={setQuotes} users={users} setUsers={setUsers} currentUser={currentUser} setCurrentUserId={setCurrentUserId} readNotifications={readNotifications} setReadNotifications={setReadNotifications} initialSection={settingsSection} onSectionChange={setSettingsSection} notify={notify} />}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegación móvil" style={{ gridTemplateColumns: `repeat(${Math.max(mobileNavItems.length, 1)}, 1fr)` }}>
        {mobileNavItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeView === id ? 'active' : ''} onClick={() => navigate(id)}>
            <Icon size={20} /><span>{label === 'Punto de venta' ? 'Venta' : label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className={`toast ${toast.tone}`}><Check size={18} /><span>{toast.message}</span></div>}
    </div>
  )
}

function LoginScreen({ businessName, branchName, setupRequired, initialUsername, onLogin, onSetup, onCompletePasswordChange }) {
  const [username, setUsername] = useState(setupRequired ? initialUsername : '')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pendingUser, setPendingUser] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isPasswordSetup = setupRequired || Boolean(pendingUser)
  const heading = setupRequired ? 'Configura el acceso inicial' : pendingUser ? 'Crea tu contraseña personal' : 'Bienvenido nuevamente'
  const detail = setupRequired
    ? 'Define la contraseña del administrador para proteger el ERP.'
    : pendingUser
      ? `${pendingUser.name}, reemplaza la contraseña temporal antes de continuar.`
      : 'Ingresa con el correo y la contraseña asignados a tu perfil.'

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (isPasswordSetup) {
      const validationError = passwordValidationMessage(password)
      if (validationError) {
        setError(validationError)
        return
      }
      if (password !== passwordConfirm) {
        setError('Las contraseñas no coinciden')
        return
      }
    }
    setSubmitting(true)
    try {
      const result = pendingUser
        ? await onCompletePasswordChange(pendingUser.userId, password)
        : setupRequired
          ? await onSetup(username, password)
          : await onLogin(username, password)
      if (result?.error) {
        setError(result.error)
      } else if (result?.requiresPasswordChange) {
        setPendingUser({ userId: result.userId, name: result.name })
        setPassword('')
        setPasswordConfirm('')
        setShowPassword(false)
      }
    } catch {
      setError('No fue posible validar el acceso. Intenta nuevamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand"><span><Hammer size={28} /></span><div><strong>{businessName}</strong><small>Sistema de gestión</small></div></div>
        <div className="login-brand-copy"><span className="login-eyebrow">ERP ferretero</span><h1>Tu operación, inventario y ventas en un solo lugar.</h1><p>Accede con tu perfil para ver únicamente los módulos y acciones que tienes autorizados.</p></div>
        <div className="login-security-note"><ShieldCheck size={20} /><span><strong>Acceso por perfil</strong><small>Administrador, vendedor o bodeguero</small></span></div>
      </section>
      <section className="login-access-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-icon"><KeyRound size={22} /></div>
          <div className="login-card-heading"><span>{branchName}</span><h2>{heading}</h2><p>{detail}</p></div>
          {!pendingUser && <label>Usuario<input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required autoFocus placeholder="nombre.usuario" /></label>}
          <label>{isPasswordSetup ? 'Nueva contraseña' : 'Contraseña'}<span className="login-password"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isPasswordSetup ? 'new-password' : 'current-password'} required placeholder="••••••••" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          {isPasswordSetup && <label>Confirmar contraseña<input type={showPassword ? 'text' : 'password'} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" required placeholder="Repite la contraseña" /><small>Usa 8 o más caracteres, con mayúscula, minúscula y número.</small></label>}
          {error && <div className="login-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}
          <button className="login-submit" disabled={submitting}>{submitting ? 'Validando acceso...' : setupRequired ? 'Configurar e ingresar' : pendingUser ? 'Guardar e ingresar' : 'Ingresar'}<ArrowRight size={18} /></button>
          {!setupRequired && !pendingUser && <p className="login-help">Si olvidaste tu contraseña, solicita al administrador que restablezca tu acceso.</p>}
        </form>
        <footer><span>{businessName}</span><small>Acceso local · {branchName}</small></footer>
      </section>
    </main>
  )
}

function Sidebar({ activeView, navigate, open, onClose, settings, products, currentUser }) {
  return (
    <>
      {open && <button className="sidebar-backdrop" onClick={onClose} aria-label="Cerrar menú" />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><Hammer size={23} strokeWidth={2.4} /></span>
          <span><strong>{settings.business.name.replace(/^Ferretería\s+/i, '')}</strong><small>Ferretería ERP</small></span>
          <button className="icon-button close-sidebar" onClick={onClose} aria-label="Cerrar menú"><X size={19} /></button>
        </div>

        <div className="branch-card">
          <span className="branch-icon"><Building2 size={18} /></span>
          <span><small>Sucursal activa</small><strong>{settings.business.branch}</strong></span>
          <ChevronDown size={14} />
        </div>

        <nav className="main-nav">
          <span className="nav-label">Operación</span>
          {navItems.slice(0, 5).filter(({ id }) => userCan(currentUser, id)).map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeView === id ? 'active' : ''} onClick={() => navigate(id)}>
              <Icon size={19} /><span>{label}</span>
              {id === 'inventory' && products.some((product) => isLowStock(product, settings)) && <em>{products.filter((product) => isLowStock(product, settings)).length}</em>}
            </button>
          ))}
          <span className="nav-label second">Gestión</span>
          {navItems.slice(5).filter(({ id }) => userCan(currentUser, id)).map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeView === id ? 'active' : ''} onClick={() => navigate(id)}>
              <Icon size={19} /><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {userCan(currentUser, 'settings') && <button className={activeView === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><Settings size={18} /><span>Configuración</span></button>}
          <div className="sync-state"><span /><small>Sistema sincronizado</small></div>
        </div>
      </aside>
    </>
  )
}

function Dashboard({ products, sales, receipts, dispatches, navigate, settings, currentUser }) {
  const lowStock = products.filter((product) => isLowStock(product, settings))
  const todaySales = sales.filter((sale) => getSaleDate(sale) === localDateKey())
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const inventoryValue = products.reduce((sum, product) => sum + product.cost * product.stock, 0)
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const weeklySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + index)
    const dateKey = localDateKey(date)
    return {
      day: date.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', ''),
      value: sales.filter((sale) => getSaleDate(sale) === dateKey).reduce((sum, sale) => sum + sale.total, 0),
    }
  })
  const weeklyTotal = weeklySales.reduce((sum, item) => sum + item.value, 0)
  const maxSale = Math.max(1, ...weeklySales.map((item) => item.value))
  const todayLabel = now.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })

  return (
    <div className="dashboard">
      <section className="welcome-row">
        <div><h2>Buenos días, {currentUser.name.split(' ')[0]}</h2><p>Esta es la actividad de tu ferretería hoy, {todayLabel}.</p></div>
        <button className="primary-button" onClick={() => navigate('pos')}><ShoppingCart size={18} />Nueva venta</button>
      </section>

      <section className="kpi-grid" aria-label="Indicadores principales">
        <Metric icon={CircleDollarSign} label="Ventas de hoy" value={money.format(todayTotal)} detail={todaySales.length ? 'Actividad registrada hoy' : 'Sin ventas registradas'} tone="positive" />
        <Metric icon={ReceiptText} label="Transacciones" value={todaySales.length} detail={`Ticket prom. ${money.format(todaySales.length ? todayTotal / todaySales.length : 0)}`} />
        <Metric icon={Warehouse} label="Valor inventario" value={money.format(inventoryValue)} detail={`${number.format(products.reduce((sum, p) => sum + p.stock, 0))} unidades`} />
        <Metric icon={AlertTriangle} label="Stock crítico" value={lowStock.length} detail="Requieren atención" tone="warning" />
      </section>

      <section className="dashboard-grid">
        <div className="panel sales-chart-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Rendimiento</span><h3>Ventas de la semana</h3></div>
            <button className="text-button" onClick={() => navigate('reports')}>Ver reporte <ArrowRight size={16} /></button>
          </div>
            <div className="chart-summary"><strong>{money.format(weeklyTotal)}</strong><span><ArrowUpRight size={14} /> {sales.filter((sale) => getSaleTimestamp(sale) >= weekStart.getTime()).length} ventas esta semana</span></div>
          <div className="bar-chart" aria-label="Gráfico de ventas semanales">
            {weeklySales.map((item) => (
              <div className="bar-column" key={item.day}>
                <div className="bar-track"><div className="bar" style={{ height: item.value ? `${Math.max(12, (item.value / maxSale) * 100)}%` : '0%' }}><span>{money.format(item.value)}</span></div></div>
                <small>{item.day}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel quick-panel">
          <div className="panel-heading"><div><span className="eyebrow">Accesos directos</span><h3>Operación rápida</h3></div></div>
          <div className="quick-actions">
            <button onClick={() => navigate('pos')}><span className="quick-icon teal"><ShoppingCart size={21} /></span><span><strong>Nueva venta</strong><small>Abrir caja y cobrar</small></span><ArrowRight size={16} /></button>
            <button onClick={() => navigate('receipts')}><span className="quick-icon blue"><ArrowDownToLine size={21} /></span><span><strong>Ingresar mercadería</strong><small>Registrar recepción</small></span><ArrowRight size={16} /></button>
            <button onClick={() => navigate('dispatches')}><span className="quick-icon amber"><Truck size={21} /></span><span><strong>Preparar despacho</strong><small>{dispatches.filter((item) => item.status === 'Preparando').length} pedido pendiente</small></span><ArrowRight size={16} /></button>
            <button onClick={() => navigate('inventory')}><span className="quick-icon coral"><Boxes size={21} /></span><span><strong>Ajustar inventario</strong><small>Revisar existencias</small></span><ArrowRight size={16} /></button>
          </div>
        </div>
      </section>

      <section className="dashboard-grid lower">
        <div className="panel activity-panel">
          <div className="panel-heading"><div><span className="eyebrow">Caja activa</span><h3>Últimas ventas</h3></div><button className="text-button" onClick={() => navigate('pos')}>Ir al POS <ArrowRight size={16} /></button></div>
          <div className="activity-list">
            {sales.slice(0, 4).map((sale) => (
              <div className="activity-row" key={sale.id}>
                <span className="activity-icon"><ReceiptText size={18} /></span>
                <span className="activity-main"><strong>{sale.id}</strong><small>{sale.customer} · {sale.items} artículos</small></span>
                <span className="activity-time">{sale.time}</span>
                <strong className="activity-total">{money.format(sale.total)}</strong>
              </div>
            ))}
            {!sales.length && <EmptyState icon={ReceiptText} title="Sin ventas registradas" text="Las nuevas ventas aparecerán aquí." />}
          </div>
        </div>

        <div className="panel stock-panel">
          <div className="panel-heading"><div><span className="eyebrow">Reposición</span><h3>Stock bajo</h3></div><span className="status-pill alert">{lowStock.length} alertas</span></div>
          <div className="stock-list">
            {lowStock.map((product) => (
              <button key={product.id} onClick={() => navigate('inventory')}>
                <ProductThumb product={product} compact />
                <span><strong>{product.name}</strong><small>{product.sku} · Mín. {product.minStock}</small></span>
                <span className="stock-count"><strong>{product.stock}</strong><small>{product.unit}</small></span>
              </button>
            ))}
            {!lowStock.length && <EmptyState icon={PackageCheck} title="Sin alertas de stock" text="No hay productos que requieran reposición." />}
          </div>
        </div>
      </section>

      <section className="operation-strip">
        <div><span className="strip-icon"><ArrowDownToLine size={20} /></span><span><small>Último ingreso</small><strong>{receipts[0] ? `${receipts[0].id} · ${receipts[0].supplier}` : 'Sin ingresos registrados'}</strong></span></div>
        <div><span className="strip-icon purple"><Truck size={20} /></span><span><small>Próximo despacho</small><strong>{dispatches[0] ? `${dispatches[0].id} · ${dispatches[0].customer}` : 'Sin despachos registrados'}</strong></span></div>
        <button onClick={() => navigate('receipts')}>Ver movimientos <ArrowRight size={16} /></button>
      </section>
    </div>
  )
}

function Metric({ icon: Icon, label, value, detail, tone }) {
  return (
    <div className="metric">
      <span className={`metric-icon ${tone || ''}`}><Icon size={21} /></span>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small className={tone === 'positive' ? 'positive-text' : tone === 'warning' ? 'warning-text' : ''}>{detail}</small>
    </div>
  )
}

function PointOfSale({ products, setProducts, customers, sales, setSales, heldSales, setHeldSales, quotes, setQuotes, notify, settings, setSettings, currentUser, can, initialQuoteId = null }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Todos')
  const [cart, setCart] = useState([])
  const [customer, setCustomer] = useState('Público general')
  const [payment, setPayment] = useState(settings.sales.defaultPayment)
  const [completedReceipt, setCompletedReceipt] = useState(null)
  const [quote, setQuote] = useState(null)
  const [showHeldSales, setShowHeldSales] = useState(false)
  const searchRef = useRef(null)
  const categories = ['Todos', ...new Set(products.map((product) => product.category))]
  const paymentMethods = settings.sales.paymentMethods.length ? settings.sales.paymentMethods : defaultSettings.sales.paymentMethods

  useEffect(() => {
    if (!initialQuoteId) return
    const savedQuote = quotes.find((item) => item.id === initialQuoteId)
    if (savedQuote) setQuote(savedQuote)
  }, [initialQuoteId, quotes])

  useEffect(() => {
    if (!paymentMethods.includes(payment)) setPayment(paymentMethods[0])
  }, [payment, paymentMethods])

  const visibleProducts = products.filter((product) => {
    const matchesCategory = category === 'Todos' || product.category === category
    const value = `${product.name} ${product.sku} ${product.brand}`.toLowerCase()
    return matchesCategory && value.includes(query.toLowerCase())
  })

  const addToCart = (product) => {
    if (settings.inventory.preventNegative && product.stock < 1) return
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id)
      if (existing) {
        if (settings.inventory.preventNegative && existing.qty >= product.stock) return current
        return current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item)
      }
      return [...current, { ...product, qty: 1 }]
    })
  }

  const changeQty = (id, delta) => {
    setCart((current) => current.map((item) => item.id === id ? { ...item, qty: settings.inventory.preventNegative ? Math.min(item.stock, item.qty + delta) : item.qty + delta } : item).filter((item) => item.qty > 0))
  }

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0)
  const net = Math.round(subtotal / 1.19)
  const tax = subtotal - net

  const completeSale = () => {
    if (!cart.length) return
    const now = new Date()
    const highestSequence = sales.reduce((highest, current) => Math.max(highest, Number(current.id.replace(/\D/g, '')) || 0), 0)
    const sequence = Math.max(Number(settings.documents.saleSequence) || 1, highestSequence + 1)
    const sale = {
      id: `V-${sequence}`,
      createdAt: now.toISOString(),
      date: localDateKey(now),
      time: now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
      customer,
      seller: currentUser.name,
      userId: currentUser.id,
      items: cart.reduce((sum, item) => sum + item.qty, 0),
      payment,
      total: subtotal,
      status: 'Completada',
    }
    const receipt = {
      ...sale,
      folio: String(sequence).padStart(8, '0'),
      date: now.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      payment,
      register: settings.sales.register,
      cashier: currentUser.name,
      net,
      tax,
      lines: cart.map(({ id, sku, name, price, qty }) => ({ id, sku, name, price, qty })),
    }
    setProducts((current) => current.map((product) => {
      const item = cart.find((cartItem) => cartItem.id === product.id)
      return item ? { ...product, stock: product.stock - item.qty } : product
    }))
    setSales((current) => [sale, ...current])
    setSettings((current) => ({ ...current, documents: { ...current.documents, saleSequence: sequence + 1 } }))
    setCart([])
    setCustomer('Público general')
    setCompletedReceipt(receipt)
  }

  const createQuote = () => {
    if (!cart.length) return
    const now = new Date()
    const validUntil = new Date(now)
    validUntil.setDate(validUntil.getDate() + Number(settings.documents.quoteValidityDays || 15))
    const storedSequence = Number(localStorage.getItem('mf-quote-sequence')) || 0
    const sequence = Math.max(Number(settings.documents.quoteSequence) || 1, storedSequence + 1)
    const generatedQuote = {
      id: `COT-${String(sequence).padStart(6, '0')}`,
      sequence,
      date: localDateKey(now),
      validUntil: localDateKey(validUntil),
      time: now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
      customer,
      seller: currentUser.name,
      userId: currentUser.id,
      net,
      tax,
      total: subtotal,
      lines: cart.map(({ id, sku, name, price, qty }) => ({ id, sku, name, price, qty })),
    }
    localStorage.setItem('mf-quote-sequence', String(sequence))
    setSettings((current) => ({ ...current, documents: { ...current.documents, quoteSequence: sequence + 1 } }))
    setQuotes((current) => [generatedQuote, ...current].slice(0, 100))
    setQuote(generatedQuote)
  }

  const holdCurrentSale = () => {
    if (!cart.length) return
    const now = new Date()
    const highestSequence = heldSales.reduce((highest, sale) => Math.max(highest, Number(sale.id.replace(/\D/g, '')) || 0), 0)
    const storedSequence = Number(localStorage.getItem('mf-held-sale-sequence')) || 0
    const sequence = Math.max(highestSequence, storedSequence) + 1
    const heldSale = {
      id: `ESP-${String(sequence).padStart(3, '0')}`,
      date: now.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', ''),
      time: now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
      customer,
      payment,
      seller: currentUser.name,
      userId: currentUser.id,
      lines: cart.map((item) => ({ ...item })),
      items: cart.reduce((sum, item) => sum + item.qty, 0),
      total: subtotal,
    }
    localStorage.setItem('mf-held-sale-sequence', String(sequence))
    setHeldSales((current) => [heldSale, ...current])
    setCart([])
    setCustomer('Público general')
    setPayment(settings.sales.defaultPayment)
    notify(`Venta ${heldSale.id} guardada en espera`)
  }

  const resumeHeldSale = (heldSale) => {
    const restoredLines = heldSale.lines.map((line) => {
      const currentProduct = products.find((product) => product.id === line.id)
      if (!currentProduct || currentProduct.stock < 1) return null
      return { ...currentProduct, price: line.price, qty: Math.min(line.qty, currentProduct.stock) }
    }).filter(Boolean)
    if (!restoredLines.length) {
      notify('No hay stock disponible para retomar esta venta', 'warning')
      return
    }
    const adjusted = restoredLines.some((line) => line.qty !== heldSale.lines.find((item) => item.id === line.id)?.qty)
    setCart(restoredLines)
    setCustomer(heldSale.customer)
    setPayment(heldSale.payment || settings.sales.defaultPayment)
    setHeldSales((current) => current.filter((sale) => sale.id !== heldSale.id))
    setShowHeldSales(false)
    notify(adjusted ? `Venta ${heldSale.id} retomada con stock ajustado` : `Venta ${heldSale.id} retomada`, adjusted ? 'warning' : 'success')
  }

  const deleteHeldSale = (id) => {
    const deletedSequence = Number(id.replace(/\D/g, '')) || 0
    const storedSequence = Number(localStorage.getItem('mf-held-sale-sequence')) || 0
    if (deletedSequence > storedSequence) localStorage.setItem('mf-held-sale-sequence', String(deletedSequence))
    setHeldSales((current) => current.filter((sale) => sale.id !== id))
    notify(`Venta ${id} eliminada`)
  }

  return (
    <>
    <div className="pos-layout">
      <section className="pos-catalog">
        <div className="module-toolbar">
          <div><h2>Venta rápida</h2><p>Selecciona productos para agregarlos al carro.</p></div>
          <button className="secondary-button" onClick={() => setShowHeldSales(true)}><Clock3 size={17} />Ventas en espera <span className="button-count">{heldSales.length}</span></button>
        </div>

        <div className="product-search-row">
          <label className="large-search"><ScanLine size={20} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Escanea o busca por nombre, SKU o marca" />{query && <button onClick={() => setQuery('')} aria-label="Limpiar búsqueda"><X size={17} /></button>}</label>
        </div>

        <div className="category-tabs">
          {categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}
        </div>

        <div className="product-grid">
          {visibleProducts.map((product) => (
            <button className="product-card" key={product.id} onClick={() => addToCart(product)} disabled={settings.inventory.preventNegative && product.stock === 0}>
              <ProductThumb product={product} />
              <span className="product-meta"><small>{product.brand} · {product.sku}</small><strong>{product.name}</strong></span>
              <span className="product-bottom"><strong>{money.format(product.price)}</strong><small className={isLowStock(product, settings) ? 'low' : ''}>{product.stock} {product.unit}</small></span>
              <span className="add-product"><Plus size={16} /></span>
            </button>
          ))}
        </div>
        {!visibleProducts.length && <EmptyState icon={Search} title="No encontramos productos" text="Prueba con otro nombre, SKU o categoría." />}
      </section>

      <aside className="cart-panel">
        <div className="cart-heading"><div><span className="eyebrow">{settings.sales.register}</span><h2>Venta actual</h2></div><span className="cart-count">{cart.reduce((sum, item) => sum + item.qty, 0)}</span></div>
        <label className="select-field"><UserRound size={17} /><select value={customer} onChange={(event) => setCustomer(event.target.value)}><option>Público general</option>{customers.filter((item) => item.active !== false).map((item) => <option key={item.id || item.rut}>{item.name}</option>)}</select><ChevronDown size={15} /></label>

        <div className="cart-items">
          {cart.length === 0 ? (
            <div className="empty-cart"><span><ShoppingCart size={28} /></span><strong>El carro está vacío</strong><p>Agrega productos desde el catálogo para comenzar una venta.</p></div>
          ) : cart.map((item) => (
            <div className="cart-item" key={item.id}>
              <ProductThumb product={item} compact />
              <div className="cart-item-info"><strong>{item.name}</strong><small>{money.format(item.price)} c/u</small>
                <div className="qty-control"><button onClick={() => changeQty(item.id, -1)} aria-label="Restar"><Minus size={14} /></button><span>{item.qty}</span><button onClick={() => changeQty(item.id, 1)} aria-label="Sumar"><Plus size={14} /></button></div>
              </div>
              <div className="cart-item-total"><button onClick={() => setCart((current) => current.filter((product) => product.id !== item.id))} aria-label="Quitar"><Trash2 size={15} /></button><strong>{money.format(item.price * item.qty)}</strong></div>
            </div>
          ))}
        </div>

        <div className="cart-summary">
          <div><span>Neto</span><strong>{money.format(net)}</strong></div>
          <div><span>IVA (19%)</span><strong>{money.format(tax)}</strong></div>
          <div className="cart-total"><span>Total</span><strong>{money.format(subtotal)}</strong></div>
        </div>

        <div className="payment-tabs">
          {paymentMethods.map((method) => <button key={method} className={payment === method ? 'active' : ''} onClick={() => setPayment(method)}>{method}</button>)}
        </div>
        <button className="checkout-button" disabled={!cart.length} onClick={completeSale}><span>Cobrar</span><strong>{money.format(subtotal)}</strong><ArrowRight size={19} /></button>
        <div className="cart-footer-actions"><button disabled={!cart.length} onClick={holdCurrentSale}><Clock3 size={16} />Dejar en espera</button><button disabled={!cart.length} onClick={createQuote}><FileText size={16} />Cotizar</button></div>
      </aside>
    </div>
    {completedReceipt && <ReceiptModal receipt={completedReceipt} settings={settings} onClose={() => { setCompletedReceipt(null); setPayment(settings.sales.defaultPayment) }} />}
    {quote && <QuoteModal quote={quote} settings={settings} onClose={() => setQuote(null)} />}
    {showHeldSales && <HeldSalesModal sales={heldSales} hasActiveCart={cart.length > 0} canDelete={can('deleteHeldSales')} onResume={resumeHeldSale} onDelete={deleteHeldSale} onClose={() => setShowHeldSales(false)} />}
    </>
  )
}

function ReceiptModal({ receipt, settings, onClose }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop receipt-backdrop" role="presentation">
      <div className="receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <div className="receipt-result-head">
          <span className="sale-success-icon"><Check size={22} /></span>
          <div><h2 id="receipt-title">Venta completada</h2><p>Boleta N° {receipt.folio} emitida correctamente</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar boleta"><X size={19} /></button>
        </div>

        <div className="receipt-stage">
          <article className="receipt-paper" aria-label={`Boleta de venta ${receipt.folio}`}>
            <header className="ticket-store">
              <span className="ticket-logo"><Hammer size={24} strokeWidth={2.3} /></span>
              <h3>{settings.business.name}</h3>
              <p>{settings.business.legalName}</p>
              <p>RUT {settings.business.rut}</p>
              <p>{settings.business.address}</p>
              <p>Tel. {settings.business.phone}</p>
              <p>{settings.business.email}</p>
            </header>

            <div className="ticket-divider" />
            <div className="ticket-document-title"><strong>BOLETA DE VENTA</strong><span>N° {receipt.folio}</span></div>
            <div className="ticket-meta">
              <div><span>Fecha</span><strong>{receipt.date} · {receipt.time}</strong></div>
              <div><span>Sucursal</span><strong>{settings.business.branch}</strong></div>
              <div><span>Caja / cajero</span><strong>{receipt.register} · {receipt.cashier}</strong></div>
              <div><span>Cliente</span><strong>{receipt.customer}</strong></div>
              <div><span>Forma de pago</span><strong>{receipt.payment}</strong></div>
            </div>

            <div className="ticket-divider" />
            <div className="ticket-items-head"><span>Detalle</span><span>Total</span></div>
            <div className="ticket-items">
              {receipt.lines.map((line) => (
                <div className="ticket-item" key={line.id}>
                  <div><strong>{line.name}</strong><small>{line.sku}</small></div>
                  <div><span>{line.qty} × {money.format(line.price)}</span><strong>{money.format(line.qty * line.price)}</strong></div>
                </div>
              ))}
            </div>

            <div className="ticket-divider" />
            <div className="ticket-totals">
              <div><span>Neto</span><strong>{money.format(receipt.net)}</strong></div>
              <div><span>IVA (19%)</span><strong>{money.format(receipt.tax)}</strong></div>
              <div className="ticket-grand-total"><span>TOTAL</span><strong>{money.format(receipt.total)}</strong></div>
            </div>

            <footer className="ticket-footer">
              <strong>¡Gracias por su compra!</strong>
              <p>{settings.documents.receiptFooter}</p>
              <span>* {receipt.id} · {receipt.folio} *</span>
            </footer>
          </article>
        </div>

        <div className="receipt-actions">
          <button className="secondary-button" onClick={onClose}><Check size={17} />Finalizar</button>
          <button className="primary-button" onClick={() => printDocument(settings.documents.receiptFormat === 'Carta' ? 'receipt-letter' : 'receipt')}><Printer size={17} />Imprimir boleta</button>
        </div>
      </div>
    </div>
  )
}

function QuoteModal({ quote, settings, onClose }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const formatDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div className="modal-backdrop quote-backdrop" role="presentation">
      <div className="quote-dialog" role="dialog" aria-modal="true" aria-labelledby="quote-title">
        <div className="quote-result-head">
          <span className="quote-file-icon"><FileText size={21} /></span>
          <div><h2 id="quote-title">Cotización comercial</h2><p>{quote.id} · válida hasta el {formatDate(quote.validUntil)}</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar cotización"><X size={19} /></button>
        </div>

        <div className="quote-stage">
          <article className="quote-paper" aria-label={`Cotización ${quote.id}`}>
            <header className="quote-header">
              <div className="quote-brand">
                <span><Hammer size={26} strokeWidth={2.2} /></span>
                <div><h3>{settings.business.name}</h3><p>{settings.business.legalName}</p><p>RUT {settings.business.rut}</p><p>{settings.business.address}</p><p>{settings.business.phone} · {settings.business.email}</p></div>
              </div>
              <div className="quote-number"><span>COTIZACIÓN</span><strong>{quote.id}</strong><small>Emisión: {formatDate(quote.date)}</small><small>Vencimiento: {formatDate(quote.validUntil)}</small></div>
            </header>

            <section className="quote-customer">
              <span>Preparada para</span>
              <strong>{quote.customer}</strong>
              <p>Ejecutivo: {quote.seller} · {settings.business.branch}</p>
            </section>

            <section className="quote-lines">
              <div className="quote-table-head"><span>Código</span><span>Descripción</span><span>Cant.</span><span>Precio unit.</span><span>Total</span></div>
              {quote.lines.map((line) => (
                <div className="quote-line" key={line.id}>
                  <code>{line.sku}</code><strong>{line.name}</strong><span>{line.qty}</span><span>{money.format(line.price)}</span><strong>{money.format(line.qty * line.price)}</strong>
                </div>
              ))}
            </section>

            <div className="quote-summary-row">
              <section className="quote-terms"><span>Condiciones comerciales</span><ul><li>Vigencia de {settings.documents.quoteValidityDays} días corridos desde la emisión.</li><li>Precios expresados en pesos chilenos e incluyen IVA.</li><li>Stock sujeto a disponibilidad al confirmar el pedido.</li><li>Retiro en {settings.business.branch}, salvo acuerdo de despacho.</li></ul></section>
              <section className="quote-totals"><div><span>Neto</span><strong>{money.format(quote.net)}</strong></div><div><span>IVA (19%)</span><strong>{money.format(quote.tax)}</strong></div><div className="quote-total"><span>Total</span><strong>{money.format(quote.total)}</strong></div></section>
            </div>

            <footer className="quote-footer"><span>{settings.business.name} · {settings.business.phone}</span><strong>{settings.documents.quoteFooter}</strong></footer>
          </article>
        </div>

        <div className="quote-actions">
          <button className="secondary-button" onClick={onClose}>Cerrar</button>
          <button className="primary-button" onClick={() => printDocument('quote')}><Printer size={17} />Imprimir cotización</button>
        </div>
      </div>
    </div>
  )
}

function HeldSalesModal({ sales, hasActiveCart, canDelete, onResume, onDelete, onClose }) {
  const [selectedId, setSelectedId] = useState(sales[0]?.id)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const selected = sales.find((sale) => sale.id === selectedId) || sales[0]

  useEffect(() => {
    if (selectedId && !sales.some((sale) => sale.id === selectedId)) setSelectedId(sales[0]?.id)
  }, [sales, selectedId])

  const removeSale = () => {
    if (!selected) return
    if (confirmDelete !== selected.id) {
      setConfirmDelete(selected.id)
      return
    }
    onDelete(selected.id)
    setConfirmDelete(null)
  }

  return (
    <Modal title="Ventas en espera" subtitle={`${sales.length} ${sales.length === 1 ? 'venta guardada' : 'ventas guardadas'} para retomar`} onClose={onClose} wide>
      <div className="held-sales-layout">
        <aside className="held-sales-list">
          <div className="held-list-heading"><span>Operaciones guardadas</span><strong>{sales.length}</strong></div>
          <div className="held-list-scroll">
            {sales.map((sale) => (
              <button key={sale.id} className={selected?.id === sale.id ? 'active' : ''} onClick={() => { setSelectedId(sale.id); setConfirmDelete(null) }}>
                <span className="held-sale-icon"><Clock3 size={17} /></span>
                <span><strong>{sale.id}</strong><small>{sale.customer}</small><em>{sale.date} · {sale.time}</em></span>
                <span className="held-list-total"><strong>{money.format(sale.total)}</strong><small>{sale.items} artículos</small></span>
              </button>
            ))}
          </div>
        </aside>

        <section className="held-sale-detail">
          {selected ? (
            <>
              <div className="held-detail-head">
                <div><span className="status-pill warning"><Clock3 size={12} />En espera</span><h3>{selected.id}</h3><p>{selected.customer} · {selected.payment}</p></div>
                <div><small>Total</small><strong>{money.format(selected.total)}</strong></div>
              </div>
              <div className="held-products-head"><span>Producto</span><span>Cant.</span><span>Total</span></div>
              <div className="held-products">
                {selected.lines.map((line) => (
                  <div className="held-product-row" key={line.id}>
                    <ProductThumb product={line} compact />
                    <span><strong>{line.name}</strong><small>{line.sku} · {money.format(line.price)} c/u</small></span>
                    <strong>{line.qty}</strong>
                    <strong>{money.format(line.qty * line.price)}</strong>
                  </div>
                ))}
              </div>
              <div className="held-detail-summary"><span><small>Artículos</small><strong>{selected.items}</strong></span><span><small>Guardada</small><strong>{selected.date}, {selected.time}</strong></span></div>
              {hasActiveCart && <div className="held-cart-warning"><AlertTriangle size={16} /><span><strong>Hay una venta activa</strong><small>Déjala en espera o finalízala antes de retomar otra.</small></span></div>}
              <div className="held-detail-actions">
                {canDelete ? <button className={`danger-button ${confirmDelete === selected.id ? 'confirm' : ''}`} onClick={removeSale}><Trash2 size={16} />{confirmDelete === selected.id ? 'Confirmar eliminación' : 'Eliminar'}</button> : <span className="permission-note">Sin permiso para eliminar</span>}
                <button className="primary-button" disabled={hasActiveCart} onClick={() => onResume(selected)}><ShoppingCart size={17} />Retomar venta<ArrowRight size={16} /></button>
              </div>
            </>
          ) : <EmptyState icon={Clock3} title="No hay ventas en espera" text="Usa “Dejar en espera” desde el carro para guardar una venta." />}
        </section>
      </div>
    </Modal>
  )
}

function Inventory({ products, setProducts, notify, settings, currentUser, can, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState('Todos')
  const [editing, setEditing] = useState(null)
  const [showProduct, setShowProduct] = useState(false)
  useEffect(() => {
    if (!initialQuery) return
    setQuery(initialQuery)
    setFilter('Todos')
  }, [initialQuery])
  const configuredCategories = splitList(settings.inventory.categories)
  const configuredUnits = splitList(settings.inventory.units)
  const categories = ['Todos', ...new Set([...configuredCategories, ...products.map((product) => product.category)])]
  const visible = products.filter((product) => {
    const matches = filter === 'Todos' || (filter === 'Stock bajo' ? isLowStock(product, settings) : product.category === filter)
    return matches && `${product.name} ${product.sku} ${product.brand}`.toLowerCase().includes(query.toLowerCase())
  })
  const totalValue = products.reduce((sum, item) => sum + item.cost * item.stock, 0)

  const saveProduct = (event) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const draft = {
      id: editing?.id || Date.now(),
      sku: data.get('sku'),
      name: data.get('name'),
      category: data.get('category'),
      brand: data.get('brand'),
      stock: Number(data.get('stock')),
      minStock: Number(data.get('minStock')),
      price: Number(data.get('price')),
      cost: Number(data.get('cost')),
      location: data.get('location'),
      unit: data.get('unit'),
      tone: editing?.tone || 'teal',
      updatedBy: currentUser.name,
    }
    setProducts((current) => editing ? current.map((item) => item.id === editing.id ? draft : item) : [draft, ...current])
    setShowProduct(false)
    setEditing(null)
    notify(editing ? 'Producto actualizado correctamente' : 'Producto creado correctamente')
  }

  const openEdit = (product) => { setEditing(product); setShowProduct(true) }

  return (
    <div className="module-page">
      <div className="module-toolbar">
        <div><h2>Inventario</h2><p>Control de existencias, precios y ubicaciones.</p></div>
        {can('editInventory') && <button className="primary-button" onClick={() => { setEditing(null); setShowProduct(true) }}><Plus size={18} />Nuevo producto</button>}
      </div>
      <section className="inventory-summary">
        <div><span><Boxes size={20} /></span><p>Productos activos<strong>{products.length}</strong></p></div>
        <div><span className="blue"><Warehouse size={20} /></span><p>Unidades en stock<strong>{number.format(products.reduce((sum, item) => sum + item.stock, 0))}</strong></p></div>
        <div><span className="amber"><AlertTriangle size={20} /></span><p>Stock crítico<strong>{products.filter((item) => isLowStock(item, settings)).length}</strong></p></div>
        <div><span className="purple"><CircleDollarSign size={20} /></span><p>Valor a costo<strong>{money.format(totalValue)}</strong></p></div>
      </section>

      <section className="data-panel">
        <div className="table-controls">
          <label className="table-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, SKU o marca" /></label>
          <div className="filter-tabs"><button className={filter === 'Todos' ? 'active' : ''} onClick={() => setFilter('Todos')}>Todos</button><button className={filter === 'Stock bajo' ? 'active' : ''} onClick={() => setFilter('Stock bajo')}>Stock bajo</button></div>
          <label className="compact-select"><select value={categories.includes(filter) ? filter : 'Todos'} onChange={(event) => setFilter(event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={15} /></label>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Ubicación</th><th>Costo</th><th>Precio venta</th><th>Stock</th><th /></tr></thead>
            <tbody>{visible.map((product) => (
              <tr key={product.id}>
                <td><div className="table-product"><ProductThumb product={product} compact /><span><strong>{product.name}</strong><small>{product.brand}</small></span></div></td>
                <td><code>{product.sku}</code></td><td>{product.category}</td><td><span className="location-tag">{product.location}</span></td><td>{money.format(product.cost)}</td><td><strong>{money.format(product.price)}</strong></td>
                <td><span className={`stock-pill ${isLowStock(product, settings) ? 'low' : ''}`}><i />{product.stock} {product.unit}</span></td>
                <td>{can('editInventory') ? <button className="row-action" onClick={() => openEdit(product)}>Editar</button> : <span className="permission-dash">Solo lectura</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="table-footer"><span>Mostrando {visible.length} de {products.length} productos</span><span>Inventario actualizado ahora</span></div>
      </section>

      {showProduct && (
        <Modal title={editing ? 'Editar producto' : 'Nuevo producto'} subtitle="Información comercial y control de stock" onClose={() => { setShowProduct(false); setEditing(null) }}>
          <form className="form-grid" onSubmit={saveProduct}>
            <label className="span-2">Nombre del producto<input name="name" defaultValue={editing?.name} required placeholder="Ej. Esmeril angular 4 1/2&quot;" /></label>
            <label>SKU<input name="sku" defaultValue={editing?.sku} required placeholder="HER-001" /></label>
            <label>Marca<input name="brand" defaultValue={editing?.brand} required placeholder="Marca" /></label>
            <label>Categoría<select name="category" defaultValue={editing?.category || configuredCategories[0] || 'Herramientas'}>{categories.filter((item) => item !== 'Todos').map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Unidad<select name="unit" defaultValue={editing?.unit || configuredUnits[0] || 'un'}>{[...new Set([...configuredUnits, ...products.map((product) => product.unit)])].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Precio costo<input name="cost" type="number" min="0" defaultValue={editing?.cost || ''} required /></label>
            <label>Precio venta<input name="price" type="number" min="0" defaultValue={editing?.price || ''} required /></label>
            <label>Stock actual<input name="stock" type="number" min="0" defaultValue={editing?.stock ?? 0} required /></label>
            <label>Stock mínimo<input name="minStock" type="number" min="0" defaultValue={editing?.minStock ?? settings.inventory.defaultMinStock} required /></label>
            <label className="span-2">Ubicación en bodega<input name="location" defaultValue={editing?.location} required placeholder="A-01-01" /></label>
            <div className="modal-actions span-2"><button type="button" className="secondary-button" onClick={() => setShowProduct(false)}>Cancelar</button><button className="primary-button" type="submit"><Check size={17} />Guardar producto</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function Receipts({ products, setProducts, receipts, setReceipts, suppliers, notify, currentUser, highlightId = null }) {
  const [showForm, setShowForm] = useState(false)
  const [lines, setLines] = useState([])
  const [productId, setProductId] = useState(String(products[0]?.id || ''))
  const [qty, setQty] = useState(1)
  const [cost, setCost] = useState(products[0]?.cost || 0)

  const selectProduct = (id) => {
    setProductId(id)
    setCost(products.find((item) => item.id === Number(id))?.cost || 0)
  }
  const addLine = () => {
    const product = products.find((item) => item.id === Number(productId))
    if (!product || qty < 1) return
    setLines((current) => [...current, { ...product, qty: Number(qty), cost: Number(cost) }])
    setQty(1)
  }
  const total = lines.reduce((sum, line) => sum + line.qty * line.cost, 0)

  const saveReceipt = (event) => {
    event.preventDefault()
    if (!lines.length) return
    const data = new FormData(event.currentTarget)
    const sequence = receipts.reduce((highest, receipt) => Math.max(highest, Number(receipt.id.replace(/\D/g, '')) || 0), 0) + 1
    const receipt = { id: `ING-${String(sequence).padStart(3, '0')}`, date: 'Hoy, ' + new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }), supplier: data.get('supplier'), document: data.get('document'), units: lines.reduce((sum, line) => sum + line.qty, 0), total, status: 'Recibido', responsible: currentUser.name, userId: currentUser.id }
    setProducts((current) => current.map((product) => {
      const received = lines.filter((line) => line.id === product.id).reduce((sum, line) => sum + line.qty, 0)
      const latest = [...lines].reverse().find((line) => line.id === product.id)
      return received ? { ...product, stock: product.stock + received, cost: latest.cost } : product
    }))
    setReceipts((current) => [receipt, ...current])
    setLines([])
    setShowForm(false)
    notify(`${receipt.id} ingresado: ${receipt.units} unidades recibidas`)
  }

  return (
    <div className="module-page">
      <div className="module-toolbar"><div><h2>Ingreso de productos</h2><p>Recepciona compras y actualiza existencias en bodega.</p></div><button className="primary-button" onClick={() => setShowForm(true)}><Plus size={18} />Nuevo ingreso</button></div>
      <section className="workflow-band">
        <div><span className="workflow-number done"><Check size={17} /></span><span><strong>Orden de compra</strong><small>Proveedor y documento</small></span></div><i />
        <div><span className="workflow-number">2</span><span><strong>Recepción</strong><small>Productos y cantidades</small></span></div><i />
        <div><span className="workflow-number">3</span><span><strong>Confirmación</strong><small>Actualización de stock</small></span></div>
      </section>
      <section className="data-panel">
        <div className="panel-heading table-title"><div><span className="eyebrow">Movimientos</span><h3>Últimos ingresos</h3></div><button className="secondary-button"><FileText size={16} />Exportar</button></div>
        <div className="table-scroll"><table><thead><tr><th>Ingreso</th><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Responsable</th><th>Unidades</th><th>Total costo</th><th>Estado</th></tr></thead>
          <tbody>{receipts.map((receipt) => <tr key={receipt.id} className={receipt.id === highlightId ? 'search-highlight' : ''}><td><strong>{receipt.id}</strong></td><td>{receipt.date}</td><td>{receipt.supplier}</td><td>{receipt.document}</td><td>{receipt.responsible || 'Matías Dintrans'}</td><td>{receipt.units}</td><td><strong>{money.format(receipt.total)}</strong></td><td><span className="status-pill success"><Check size={13} />{receipt.status}</span></td></tr>)}</tbody>
        </table></div>
      </section>
      {showForm && (
        <Modal title="Nuevo ingreso" subtitle="Registra la recepción de mercadería" onClose={() => setShowForm(false)} wide>
          <form onSubmit={saveReceipt} className="receipt-form">
            <div className="form-grid">
              <label>Proveedor<select name="supplier">{suppliers.filter((supplier) => supplier.active).map((supplier) => <option key={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Documento<input name="document" required placeholder="Factura o guía de despacho" /></label>
            </div>
            <div className="line-builder">
              <label>Producto<select value={productId} onChange={(event) => selectProduct(event.target.value)}>{products.map((product) => <option value={product.id} key={product.id}>{product.sku} · {product.name}</option>)}</select></label>
              <label>Cantidad<input value={qty} onChange={(event) => setQty(event.target.value)} type="number" min="1" /></label>
              <label>Costo unitario<input value={cost} onChange={(event) => setCost(event.target.value)} type="number" min="0" /></label>
              <button type="button" className="secondary-button" onClick={addLine}><Plus size={17} />Agregar</button>
            </div>
            <LineTable lines={lines} setLines={setLines} valueKey="cost" />
            <div className="document-total"><span>Total del ingreso</span><strong>{money.format(total)}</strong></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={!lines.length}><PackageCheck size={17} />Confirmar recepción</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function Dispatches({ products, setProducts, customers, dispatches, setDispatches, notify, settings, currentUser, highlightId = null }) {
  const [showForm, setShowForm] = useState(false)
  const [lines, setLines] = useState([])
  const [productId, setProductId] = useState(String(products[0]?.id || ''))
  const [qty, setQty] = useState(1)
  const [customerId, setCustomerId] = useState('')
  const [delivery, setDelivery] = useState({ customer: '', contact: '', address: '' })
  const availableProducts = settings.inventory.preventNegative ? products.filter((product) => product.stock > 0) : products

  const closeDispatchForm = () => {
    setShowForm(false)
    setLines([])
    setCustomerId('')
    setDelivery({ customer: '', contact: '', address: '' })
  }

  const selectDispatchCustomer = (value) => {
    setCustomerId(value)
    if (!value) {
      setDelivery({ customer: '', contact: '', address: '' })
      return
    }
    const selected = customers.find((customer) => String(customer.id ?? customer.rut ?? customer.name) === value)
    if (!selected) return
    setDelivery({
      customer: selected.name || '',
      contact: [selected.contact, selected.phone].filter(Boolean).join(' · '),
      address: [selected.address, selected.commune].filter(Boolean).join(', '),
    })
  }

  const addLine = () => {
    const product = products.find((item) => item.id === Number(productId))
    if (!product || qty < 1) return
    const alreadyAdded = lines.filter((line) => line.id === product.id).reduce((sum, line) => sum + line.qty, 0)
    if (settings.inventory.preventNegative && Number(qty) + alreadyAdded > product.stock) { notify(`Solo hay ${product.stock} unidades disponibles`, 'warning'); return }
    setLines((current) => [...current, { ...product, qty: Number(qty) }])
    setQty(1)
  }

  const saveDispatch = (event) => {
    event.preventDefault()
    if (!lines.length) return
    const data = new FormData(event.currentTarget)
    const sequence = dispatches.reduce((highest, dispatch) => Math.max(highest, Number(dispatch.id.replace(/\D/g, '')) || 0), 0) + 1
    const dispatch = { id: `DES-${String(sequence).padStart(3, '0')}`, date: 'Hoy, ' + new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }), customer: delivery.customer.trim(), contact: delivery.contact.trim(), address: delivery.address.trim(), order: data.get('order').trim(), units: lines.reduce((sum, line) => sum + line.qty, 0), status: 'Preparando', responsible: currentUser.name, userId: currentUser.id }
    setProducts((current) => current.map((product) => {
      const outgoing = lines.filter((line) => line.id === product.id).reduce((sum, line) => sum + line.qty, 0)
      return outgoing ? { ...product, stock: product.stock - outgoing } : product
    }))
    setDispatches((current) => [dispatch, ...current])
    closeDispatchForm()
    notify(`${dispatch.id} creado y stock reservado`)
  }

  const advance = (id) => {
    const order = ['Preparando', 'Despachado', 'Entregado']
    setDispatches((current) => current.map((item) => item.id === id ? { ...item, status: order[Math.min(order.indexOf(item.status) + 1, 2)] } : item))
    notify('Estado del despacho actualizado')
  }

  return (
    <div className="module-page">
      <div className="module-toolbar"><div><h2>Despachos</h2><p>Prepara, controla y entrega pedidos de clientes.</p></div><button className="primary-button" onClick={() => setShowForm(true)}><Plus size={18} />Nuevo despacho</button></div>
      <section className="dispatch-board">
        {['Preparando', 'Despachado', 'Entregado'].map((status, index) => {
          const Icon = [ClipboardCheck, Truck, PackageCheck][index]
          const items = dispatches.filter((item) => item.status === status)
          return <div className="dispatch-column" key={status}><div className="column-title"><span><Icon size={18} /></span><strong>{status}</strong><em>{items.length}</em></div>
            <div className="dispatch-items">{items.length ? items.map((item) => <div className={`dispatch-card ${item.id === highlightId ? 'search-highlight' : ''}`} key={item.id}><div><strong>{item.id}</strong><span className={`status-dot s${index}`} /></div><h4>{item.customer}</h4><p>{item.order}</p>{(item.address || item.contact) && <div className="dispatch-delivery">{item.address && <span><MapPin size={13} />{item.address}</span>}{item.contact && <span><Phone size={13} />{item.contact}</span>}</div>}<div className="dispatch-meta"><span><Box size={14} />{item.units} unidades</span><span><Clock3 size={14} />{item.date}</span></div><span className="dispatch-owner"><UserRound size={13} />{item.responsible || 'Matías Dintrans'}</span>{index < 2 && <button onClick={() => advance(item.id)}>{index === 0 ? 'Marcar despachado' : 'Confirmar entrega'}<ArrowRight size={15} /></button>}</div>) : <div className="column-empty">Sin pedidos en esta etapa</div>}</div>
          </div>
        })}
      </section>
      {showForm && (
        <Modal title="Nuevo despacho" subtitle="Reserva stock y prepara la salida" onClose={closeDispatchForm} wide>
          <form onSubmit={saveDispatch} className="receipt-form">
            <div className="form-grid dispatch-customer-form">
              <label className="span-2">Cliente registrado<select value={customerId} onChange={(event) => selectDispatchCustomer(event.target.value)}><option value="">Ingresar datos manualmente</option>{customers.filter((item) => item.active !== false).map((item) => { const value = String(item.id ?? item.rut ?? item.name); return <option value={value} key={value}>{item.name}{item.rut ? ` · ${item.rut}` : ''}</option> })}</select><small>Selecciona un cliente para completar automáticamente sus datos.</small></label>
              <label>Nombre del cliente<input name="customer" value={delivery.customer} onChange={(event) => setDelivery((current) => ({ ...current, customer: event.target.value }))} required placeholder="Nombre o razón social" /></label>
              <label>Contacto<input name="contact" value={delivery.contact} onChange={(event) => setDelivery((current) => ({ ...current, contact: event.target.value }))} required placeholder="Persona o teléfono de contacto" /></label>
              <label className="span-2">Dirección de entrega<input name="address" value={delivery.address} onChange={(event) => setDelivery((current) => ({ ...current, address: event.target.value }))} required placeholder="Calle, número, comuna y referencia" /></label>
              <label className="span-2">Pedido / referencia<input name="order" required placeholder="Pedido #1 u orden de compra" /></label>
            </div>
            <div className="line-builder dispatch-line"><label>Producto<select value={productId} onChange={(event) => setProductId(event.target.value)}>{availableProducts.map((product) => <option value={product.id} key={product.id}>{product.sku} · {product.name} ({product.stock} disp.)</option>)}</select></label><label>Cantidad<input value={qty} onChange={(event) => setQty(event.target.value)} type="number" min="1" /></label><button type="button" className="secondary-button" onClick={addLine}><Plus size={17} />Agregar</button></div>
            <LineTable lines={lines} setLines={setLines} />
            <div className="document-total"><span>Total de unidades</span><strong>{lines.reduce((sum, line) => sum + line.qty, 0)}</strong></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={closeDispatchForm}>Cancelar</button><button className="primary-button" disabled={!lines.length}><Truck size={17} />Crear despacho</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function LineTable({ lines, setLines, valueKey }) {
  return <div className={`line-table ${valueKey ? 'with-value' : 'no-value'}`}><div className="line-table-head"><span>Producto</span><span>Cantidad</span>{valueKey && <span>Costo</span>}<span /></div>{lines.length ? lines.map((line, index) => <div className="line-table-row" key={`${line.id}-${index}`}><span><strong>{line.name}</strong><small>{line.sku}</small></span><span>{line.qty} {line.unit}</span>{valueKey && <span>{money.format(line.qty * line[valueKey])}</span>}<button type="button" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button></div>) : <div className="line-table-empty">Agrega productos para continuar</div>}</div>
}

function Customers({ customers, sales }) {
  return <div className="module-page"><div className="module-toolbar"><div><h2>Clientes</h2><p>Cuentas comerciales, contactos e historial de compra.</p></div><button className="primary-button"><Plus size={18} />Nuevo cliente</button></div><section className="customer-grid">{customers.length ? customers.map((customer) => <div className="customer-card" key={customer.id || customer.rut}><div className="customer-top"><span className={`customer-avatar ${customer.tone || 'teal'}`}>{customer.name.split(' ').slice(0, 2).map((word) => word[0]).join('')}</span><button className="row-action">Ver ficha</button></div><h3>{customer.name}</h3><p>{customer.rut}</p><div className="customer-contact"><span><UserRound size={15} />{customer.contact}</span><span>{customer.phone}</span></div><div className="customer-stats"><span><small>Compras</small><strong>{customer.sales || 0}</strong></span><span><small>Total histórico</small><strong>{money.format(customer.balance || 0)}</strong></span></div></div>) : <EmptyState icon={Users} title="Sin clientes registrados" text="Los clientes que agregues aparecerán aquí." />}</section><div className="customer-note"><Users size={19} /><span><strong>{new Set(sales.map((sale) => sale.customer).filter((customer) => customer && customer !== 'Público general')).size} clientes con actividad reciente</strong><small>La información se actualiza con cada venta registrada.</small></span></div></div>
}

function Suppliers({ suppliers, setSuppliers, notify }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('Todos')
  const [selectedId, setSelectedId] = useState(suppliers[0]?.id)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const categories = [...new Set(suppliers.map((supplier) => supplier.category))]
  const visible = suppliers.filter((supplier) => {
    const searchable = `${supplier.name} ${supplier.rut} ${supplier.contact} ${supplier.category} ${supplier.email}`.toLowerCase()
    const matchesFilter = filter === 'Todos' || (filter === 'Favoritos' ? supplier.favorite : supplier.category === filter)
    return matchesFilter && searchable.includes(query.toLowerCase())
  })
  const selected = suppliers.find((supplier) => supplier.id === selectedId) || visible[0] || suppliers[0]
  const initials = (name) => name.split(' ').slice(0, 2).map((word) => word[0]).join('').toUpperCase()

  const toggleFavorite = (id) => {
    setSuppliers((current) => current.map((supplier) => supplier.id === id ? { ...supplier, favorite: !supplier.favorite } : supplier))
  }

  const openForm = (supplier = null) => {
    setEditing(supplier)
    setShowForm(true)
  }

  const saveSupplier = (event) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const supplier = {
      id: editing?.id || Date.now(),
      name: data.get('name'),
      rut: data.get('rut'),
      category: data.get('category'),
      contact: data.get('contact'),
      role: data.get('role'),
      phone: data.get('phone'),
      email: data.get('email'),
      address: data.get('address'),
      website: data.get('website'),
      paymentTerms: data.get('paymentTerms'),
      leadTime: data.get('leadTime'),
      lastOrder: editing?.lastOrder || 'Sin compras registradas',
      totalPurchases: editing?.totalPurchases || 0,
      notes: data.get('notes'),
      favorite: editing?.favorite || false,
      active: data.get('active') === 'on',
      tone: editing?.tone || 'teal',
    }
    setSuppliers((current) => editing ? current.map((item) => item.id === editing.id ? supplier : item) : [supplier, ...current])
    setSelectedId(supplier.id)
    setShowForm(false)
    setEditing(null)
    notify(editing ? 'Datos del proveedor actualizados' : 'Proveedor agregado a la agenda')
  }

  const totalPurchases = suppliers.reduce((sum, supplier) => sum + supplier.totalPurchases, 0)

  return (
    <div className="module-page suppliers-page">
      <div className="module-toolbar">
        <div><h2>Proveedores</h2><p>Agenda de contactos y condiciones comerciales.</p></div>
        <button className="primary-button" onClick={() => openForm()}><Plus size={18} />Nuevo proveedor</button>
      </div>

      <section className="supplier-summary">
        <div><span><Building2 size={20} /></span><p>Proveedores activos<strong>{suppliers.filter((supplier) => supplier.active).length}</strong></p></div>
        <div><span className="amber"><Star size={20} /></span><p>Contactos favoritos<strong>{suppliers.filter((supplier) => supplier.favorite).length}</strong></p></div>
        <div><span className="blue"><CircleDollarSign size={20} /></span><p>Compras registradas<strong>{money.format(totalPurchases)}</strong></p></div>
      </section>

      <section className="supplier-workspace">
        <aside className="supplier-directory">
          <div className="supplier-search">
            <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Empresa, contacto o rubro" />{query && <button onClick={() => setQuery('')} aria-label="Limpiar"><X size={15} /></button>}</label>
            <div className="filter-tabs"><button className={filter === 'Todos' ? 'active' : ''} onClick={() => setFilter('Todos')}>Todos</button><button className={filter === 'Favoritos' ? 'active' : ''} onClick={() => setFilter('Favoritos')}><Star size={12} />Favoritos</button></div>
            <label className="supplier-category"><select value={categories.includes(filter) ? filter : 'Todas las categorías'} onChange={(event) => setFilter(event.target.value === 'Todas las categorías' ? 'Todos' : event.target.value)}><option>Todas las categorías</option>{categories.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={15} /></label>
          </div>
          <div className="supplier-list">
            {visible.map((supplier) => (
              <button key={supplier.id} className={selected?.id === supplier.id ? 'active' : ''} onClick={() => setSelectedId(supplier.id)}>
                <span className={`supplier-avatar ${supplier.tone}`}>{initials(supplier.name)}</span>
                <span className="supplier-list-copy"><strong>{supplier.name}</strong><small>{supplier.contact} · {supplier.category}</small></span>
                {supplier.favorite && <Star className="favorite-mark" size={14} fill="currentColor" />}
              </button>
            ))}
            {!visible.length && <EmptyState icon={Search} title="Sin coincidencias" text="Prueba con otro contacto o rubro." />}
          </div>
          <div className="directory-footer">{visible.length} de {suppliers.length} proveedores</div>
        </aside>

        {selected ? (
          <article className="supplier-detail">
            <div className="supplier-detail-head">
              <div className={`supplier-avatar large ${selected.tone}`}>{initials(selected.name)}</div>
              <div className="supplier-title"><div><h3>{selected.name}</h3>{selected.active ? <span className="status-pill success"><Check size={12} />Activo</span> : <span className="status-pill alert">Inactivo</span>}</div><p>{selected.rut} · {selected.category}</p></div>
              <div className="supplier-head-actions"><button className={`icon-button ${selected.favorite ? 'is-favorite' : ''}`} onClick={() => toggleFavorite(selected.id)} aria-label={selected.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'} title="Favorito"><Star size={18} fill={selected.favorite ? 'currentColor' : 'none'} /></button><button className="secondary-button" onClick={() => openForm(selected)}><Pencil size={16} />Editar</button></div>
            </div>

            <div className="supplier-detail-body">
              <section className="supplier-contact-block">
                <div className="section-caption"><UserRound size={17} /><span><small>Contacto principal</small><strong>{selected.contact}</strong><em>{selected.role}</em></span></div>
                <div className="contact-actions">
                  <a href={`tel:${selected.phone.replace(/\s/g, '')}`}><span><Phone size={17} /></span><span><small>Teléfono</small><strong>{selected.phone}</strong></span></a>
                  <a href={`mailto:${selected.email}`}><span><Mail size={17} /></span><span><small>Correo electrónico</small><strong>{selected.email}</strong></span></a>
                  <div><span><MapPin size={17} /></span><span><small>Dirección</small><strong>{selected.address}</strong></span></div>
                  <a href={`https://${selected.website}`} target="_blank" rel="noreferrer"><span><Globe2 size={17} /></span><span><small>Sitio web</small><strong>{selected.website}</strong></span></a>
                </div>
              </section>

              <section className="supplier-commercial">
                <div className="section-heading"><span className="eyebrow">Acuerdo comercial</span><h4>Condiciones vigentes</h4></div>
                <div className="commercial-grid">
                  <div><small>Condición de pago</small><strong>{selected.paymentTerms}</strong></div>
                  <div><small>Tiempo de entrega</small><strong>{selected.leadTime}</strong></div>
                  <div><small>Última compra</small><strong>{selected.lastOrder}</strong></div>
                  <div><small>Compras acumuladas</small><strong>{money.format(selected.totalPurchases)}</strong></div>
                </div>
              </section>

              <section className="supplier-notes"><div className="section-heading"><span className="eyebrow">Notas internas</span><h4>Información útil</h4></div><p>{selected.notes || 'Sin notas registradas para este proveedor.'}</p></section>
            </div>
          </article>
        ) : <div className="supplier-detail"><EmptyState icon={Building2} title="Selecciona un proveedor" text="La ficha comercial aparecerá aquí." /></div>}
      </section>

      {showForm && (
        <Modal title={editing ? 'Editar proveedor' : 'Nuevo proveedor'} subtitle="Datos de contacto y condiciones comerciales" onClose={() => { setShowForm(false); setEditing(null) }} wide>
          <form className="form-grid supplier-form" onSubmit={saveSupplier}>
            <label>Razón social<input name="name" defaultValue={editing?.name} required placeholder="Empresa SpA" /></label>
            <label>RUT<input name="rut" defaultValue={editing?.rut} required placeholder="76.123.456-7" /></label>
            <label className="span-2">Rubro principal<input name="category" defaultValue={editing?.category} required placeholder="Herramientas, pinturas, electricidad..." /></label>
            <div className="form-section-title span-2"><span>Contacto principal</span></div>
            <label>Nombre<input name="contact" defaultValue={editing?.contact} required placeholder="Nombre y apellido" /></label>
            <label>Cargo<input name="role" defaultValue={editing?.role} required placeholder="Ejecutivo comercial" /></label>
            <label>Teléfono<input name="phone" type="tel" defaultValue={editing?.phone} required placeholder="+56 9 1234 5678" /></label>
            <label>Correo<input name="email" type="email" defaultValue={editing?.email} required placeholder="contacto@empresa.cl" /></label>
            <label className="span-2">Dirección<input name="address" defaultValue={editing?.address} required placeholder="Calle, número y comuna" /></label>
            <label className="span-2">Sitio web<input name="website" defaultValue={editing?.website} placeholder="www.empresa.cl" /></label>
            <div className="form-section-title span-2"><span>Condiciones comerciales</span></div>
            <label>Condición de pago<input name="paymentTerms" defaultValue={editing?.paymentTerms} required placeholder="30 días" /></label>
            <label>Tiempo de entrega<input name="leadTime" defaultValue={editing?.leadTime} required placeholder="3 a 5 días" /></label>
            <label className="span-2">Notas<textarea name="notes" defaultValue={editing?.notes} rows="3" placeholder="Pedidos mínimos, días de despacho, marcas representadas..." /></label>
            <label className="checkbox-field span-2"><input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /><span><strong>Proveedor activo</strong><small>Disponible para nuevos ingresos y órdenes de compra.</small></span></label>
            <div className="modal-actions span-2"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" type="submit"><Check size={17} />Guardar proveedor</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function Reports({ products, sales, notify, settings, can, initialQuery = '' }) {
  const today = localDateKey()
  const [query, setQuery] = useState(initialQuery)
  const [period, setPeriod] = useState('Todos')
  const [day, setDay] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [year, setYear] = useState(today.slice(0, 4))
  const [paymentFilter, setPaymentFilter] = useState('Todos')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!initialQuery) return
    setQuery(initialQuery)
    setPeriod('Todos')
    setPaymentFilter('Todos')
  }, [initialQuery])

  const normalizedSales = useMemo(() => {
    return sales.map((sale) => ({
      ...sale,
      date: getSaleDate(sale),
      payment: getSalePayment(sale),
      seller: sale.seller || 'Matías Dintrans',
    }))
  }, [sales, today])

  const years = [...new Set([...normalizedSales.map((sale) => sale.date.slice(0, 4)), today.slice(0, 4)])].sort((a, b) => b.localeCompare(a))
  const paymentMethods = [...new Set(normalizedSales.map((sale) => sale.payment))]

  const filteredSales = useMemo(() => normalizedSales.filter((sale) => {
    const searchValue = `${sale.id} ${sale.customer}`.toLowerCase()
    const matchesQuery = searchValue.includes(query.trim().toLowerCase())
    const matchesPayment = paymentFilter === 'Todos' || sale.payment === paymentFilter
    const matchesPeriod = period === 'Todos'
      || (period === 'Día' && sale.date === day)
      || (period === 'Mes' && sale.date.startsWith(month))
      || (period === 'Año' && sale.date.startsWith(year))
    return matchesQuery && matchesPayment && matchesPeriod
  }).sort((a, b) => {
    const timestampDifference = getSaleTimestamp(b) - getSaleTimestamp(a)
    if (timestampDifference) return timestampDifference
    return (Number(b.id.replace(/\D/g, '')) || 0) - (Number(a.id.replace(/\D/g, '')) || 0)
  }), [normalizedSales, query, paymentFilter, period, day, month, year])

  const totalSales = filteredSales.reduce((sum, sale) => sum + sale.total, 0)
  const totalItems = filteredSales.reduce((sum, sale) => sum + sale.items, 0)
  const averageTicket = filteredSales.length ? Math.round(totalSales / filteredSales.length) : 0

  const trend = useMemo(() => {
    const monthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const groups = new Map()
    filteredSales.forEach((sale) => {
      let key = sale.date
      let label = new Date(`${sale.date}T12:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }).replace('.', '')
      if (period === 'Día') {
        key = sale.time.slice(0, 2)
        label = `${key} h`
      } else if (period === 'Mes') {
        key = sale.date.slice(8, 10)
        label = key
      } else if (period === 'Año') {
        key = sale.date.slice(5, 7)
        label = monthLabels[Number(key) - 1]
      }
      const current = groups.get(key) || { key, label, value: 0 }
      current.value += sale.total
      groups.set(key, current)
    })
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-12)
  }, [filteredSales, period])

  const paymentBreakdown = useMemo(() => {
    const groups = filteredSales.reduce((result, sale) => ({ ...result, [sale.payment]: (result[sale.payment] || 0) + sale.total }), {})
    return Object.entries(groups).sort((a, b) => b[1] - a[1])
  }, [filteredSales])

  const categoryTotals = Object.entries(products.reduce((groups, product) => ({ ...groups, [product.category]: (groups[product.category] || 0) + product.stock * product.cost }), {})).sort((a, b) => b[1] - a[1])
  const maxCategory = Math.max(...categoryTotals.map(([, value]) => value), 1)
  const maxTrend = Math.max(...trend.map((item) => item.value), 1)

  const periodLabel = period === 'Día' ? new Date(`${day}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
    : period === 'Mes' ? new Date(`${month}-01T12:00:00`).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
      : period === 'Año' ? year : 'Todo el historial'

  const resetFilters = () => {
    setQuery('')
    setPeriod('Todos')
    setPaymentFilter('Todos')
    setDay(today)
    setMonth(today.slice(0, 7))
    setYear(today.slice(0, 4))
  }

  const exportToExcel = async () => {
    if (!filteredSales.length || exporting) return
    setExporting(true)
    try {
      const { default: writeExcelFile } = await import('write-excel-file/browser')
      const headerCell = (value) => ({ value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#0F766E', align: 'center' })
      const rows = [
        [{ value: settings.business.name, fontWeight: 'bold', fontSize: 16, columnSpan: 8 }],
        [{ value: `Reporte de ventas · ${periodLabel}`, fontWeight: 'bold', textColor: '#53615E', columnSpan: 8 }],
        [{ value: `Generado el ${new Date().toLocaleString('es-CL')}`, textColor: '#697675', columnSpan: 8 }],
        [],
        ['Folio', 'Fecha', 'Hora', 'Cliente', 'Vendedor', 'Medio de pago', 'Artículos', 'Total'].map(headerCell),
        ...filteredSales.map((sale) => [
          { value: sale.id },
          { value: sale.date },
          { value: sale.time },
          { value: sale.customer },
          { value: sale.seller },
          { value: sale.payment },
          { value: sale.items, type: Number, align: 'center' },
          { value: sale.total, type: Number, format: '[$$-es-CL]#,##0', align: 'right' },
        ]),
        [],
        [
          { value: 'RESUMEN', fontWeight: 'bold' },
          { value: `${filteredSales.length} ventas`, fontWeight: 'bold' },
          { value: '' },
          { value: '' },
          { value: '' },
          { value: '' },
          { value: totalItems, type: Number, fontWeight: 'bold', align: 'center' },
          { value: totalSales, type: Number, format: '[$$-es-CL]#,##0', fontWeight: 'bold', backgroundColor: '#E5F3F1', align: 'right' },
        ],
      ]
      const filePeriod = periodLabel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
      await writeExcelFile(rows, {
        sheet: 'Ventas',
        columns: [{ width: 14 }, { width: 13 }, { width: 12 }, { width: 28 }, { width: 22 }, { width: 18 }, { width: 12 }, { width: 16 }],
        stickyRowsCount: 5,
        showGridLines: false,
        fontFamily: 'Arial',
      }).toFile(`ventas-${filePeriod}.xlsx`)
      notify(`Excel exportado: ${filteredSales.length} ventas`)
    } catch {
      notify('No fue posible generar el archivo Excel', 'warning')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="module-page reports-page">
      <div className="module-toolbar">
        <div><h2>Reportes de ventas</h2><p>Consulta el historial por período y exporta los resultados.</p></div>
        <button className="primary-button" onClick={exportToExcel} disabled={!can('exportReports') || !filteredSales.length || exporting} title={!can('exportReports') ? 'Tu perfil no puede exportar reportes' : undefined}><FileSpreadsheet size={18} />{exporting ? 'Generando...' : 'Exportar Excel'}</button>
      </div>

      <section className="report-filters">
        <div className="filter-heading"><span><CalendarDays size={18} /></span><div><strong>Período de consulta</strong><small>{periodLabel}</small></div></div>
        <div className="report-filter-controls">
          <label className="report-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar folio o cliente" />{query && <button onClick={() => setQuery('')} aria-label="Limpiar búsqueda"><X size={15} /></button>}</label>
          <div className="period-switch" aria-label="Agrupar ventas por período">{['Todos', 'Día', 'Mes', 'Año'].map((item) => <button key={item} className={period === item ? 'active' : ''} onClick={() => setPeriod(item)}>{item}</button>)}</div>
          {period === 'Día' && <label className="date-filter"><span>Fecha</span><input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>}
          {period === 'Mes' && <label className="date-filter"><span>Mes</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}
          {period === 'Año' && <label className="date-filter"><span>Año</span><select value={year} onChange={(event) => setYear(event.target.value)}>{years.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>}
          <label className="date-filter payment-filter"><span>Pago</span><select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option>Todos</option>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select><ChevronDown size={14} /></label>
          <button className="reset-filter" onClick={resetFilters} title="Limpiar filtros" aria-label="Limpiar filtros"><RotateCcw size={17} /></button>
        </div>
      </section>

      <section className="report-kpis">
        <div><span className="report-kpi-icon"><CircleDollarSign size={20} /></span><p>Venta bruta<strong>{money.format(totalSales)}</strong></p></div>
        <div><span className="report-kpi-icon blue"><ReceiptText size={20} /></span><p>Ventas encontradas<strong>{number.format(filteredSales.length)}</strong></p></div>
        <div><span className="report-kpi-icon amber"><ShoppingCart size={20} /></span><p>Ticket promedio<strong>{money.format(averageTicket)}</strong></p></div>
        <div><span className="report-kpi-icon purple"><Boxes size={20} /></span><p>Artículos vendidos<strong>{number.format(totalItems)}</strong></p></div>
      </section>

      <section className="report-grid filtered-report-grid">
        <div className="panel report-main">
          <div className="panel-heading"><div><span className="eyebrow">{periodLabel}</span><h3>Ventas del período</h3></div><span className="status-pill success">{filteredSales.length} registros</span></div>
          {trend.length ? <div className="report-chart dynamic-chart">{trend.map((item) => <div key={item.key}><span style={{ height: `${Math.max(7, (item.value / maxTrend) * 100)}%` }} title={`${item.label}: ${money.format(item.value)}`} /><small>{item.label}</small></div>)}</div> : <EmptyState icon={BarChart3} title="Sin ventas en este período" text="Prueba con otra fecha o limpia los filtros." />}
        </div>
        <div className="panel report-side">
          <span className="eyebrow">Composición</span><h3>Medios de pago</h3>
          {paymentBreakdown.length ? <div className="payment-breakdown">{paymentBreakdown.map(([method, value]) => <div key={method}><span><strong>{method}</strong><small>{money.format(value)}</small></span><i><b style={{ width: `${totalSales ? (value / totalSales) * 100 : 0}%` }} /></i></div>)}</div> : <EmptyState icon={ReceiptText} title="Sin información" text="No hay medios de pago para mostrar." />}
        </div>
      </section>

      <section className="data-panel sales-report-table">
        <div className="panel-heading table-title"><div><span className="eyebrow">Detalle</span><h3>Ventas realizadas</h3></div><span className="table-result-count">{filteredSales.length} resultados</span></div>
        <div className="table-scroll"><table><thead><tr><th>Folio</th><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Vendedor</th><th>Medio de pago</th><th>Artículos</th><th>Total</th></tr></thead><tbody>
          {filteredSales.length ? filteredSales.map((sale) => <tr key={sale.id}><td><strong className="sale-folio">{sale.id}</strong></td><td>{new Date(`${sale.date}T12:00:00`).toLocaleDateString('es-CL')}</td><td>{sale.time}</td><td><strong>{sale.customer}</strong></td><td>{sale.seller}</td><td><span className="payment-badge">{sale.payment}</span></td><td>{sale.items}</td><td><strong>{money.format(sale.total)}</strong></td></tr>) : <tr><td colSpan="8"><EmptyState icon={Search} title="No encontramos ventas" text="Cambia el período o los filtros de búsqueda." /></td></tr>}
        </tbody></table></div>
        <div className="report-table-total"><span>Total filtrado</span><strong>{money.format(totalSales)}</strong></div>
      </section>

      <section className="data-panel categories-report report-inventory-value"><div className="panel-heading table-title"><div><span className="eyebrow">Inventario</span><h3>Valor por categoría</h3></div></div>{categoryTotals.map(([category, value]) => <div className="category-value" key={category}><span>{category}</span><div><i style={{ width: `${(value / maxCategory) * 100}%` }} /></div><strong>{money.format(value)}</strong></div>)}</section>
    </div>
  )
}

function Configuration({ settings, setSettings, products, setProducts, customers, setCustomers, sales, setSales, receipts, setReceipts, dispatches, setDispatches, suppliers, setSuppliers, heldSales, setHeldSales, quotes, setQuotes, users, setUsers, currentUser, setCurrentUserId, readNotifications, setReadNotifications, initialSection, onSectionChange, notify }) {
  const [section, setSection] = useState(initialSection)
  const [draft, setDraft] = useState(settings)
  const [confirmReset, setConfirmReset] = useState(false)
  const [userDraft, setUserDraft] = useState(null)
  const [userSaving, setUserSaving] = useState(false)
  const importRef = useRef(null)

  useEffect(() => setDraft(settings), [settings])
  useEffect(() => setSection(initialSection), [initialSection])

  const sections = [
    { id: 'business', label: 'Datos del negocio', detail: 'Identidad y sucursal', icon: Building2 },
    { id: 'sales', label: 'Ventas y caja', detail: 'Caja y medios de pago', icon: ShoppingCart },
    { id: 'documents', label: 'Documentos', detail: 'Folios e impresión', icon: FileText },
    { id: 'inventory', label: 'Inventario', detail: 'Stock y catálogos', icon: Boxes },
    { id: 'notifications', label: 'Notificaciones', detail: 'Alertas del sistema', icon: Bell },
    ...(userCan(currentUser, 'manageUsers') ? [{ id: 'users', label: 'Usuarios y permisos', detail: 'Accesos y responsables', icon: Users }] : []),
    { id: 'initial-load', label: 'Carga inicial', detail: 'Plantillas e importación', icon: Upload },
    { id: 'backup', label: 'Respaldo', detail: 'Exportar y restaurar', icon: Box },
  ]

  const updateSection = (group, key, value) => {
    setDraft((current) => ({ ...current, [group]: { ...current[group], [key]: value } }))
  }

  const togglePayment = (method) => {
    const isEnabled = draft.sales.paymentMethods.includes(method)
    if (isEnabled && draft.sales.paymentMethods.length === 1) {
      notify('Debe quedar al menos un medio de pago habilitado', 'warning')
      return
    }
    const methods = isEnabled ? draft.sales.paymentMethods.filter((item) => item !== method) : [...draft.sales.paymentMethods, method]
    setDraft((current) => ({
      ...current,
      sales: {
        ...current.sales,
        paymentMethods: methods,
        defaultPayment: methods.includes(current.sales.defaultPayment) ? current.sales.defaultPayment : methods[0],
      },
    }))
  }

  const saveSettings = (event) => {
    event.preventDefault()
    const next = normalizeSettings({
      ...draft,
      documents: {
        ...draft.documents,
        saleSequence: Math.max(1, Number(draft.documents.saleSequence) || 1),
        quoteSequence: Math.max(1, Number(draft.documents.quoteSequence) || 1),
        quoteValidityDays: Math.max(1, Number(draft.documents.quoteValidityDays) || 1),
      },
      inventory: {
        ...draft.inventory,
        defaultMinStock: Math.max(0, Number(draft.inventory.defaultMinStock) || 0),
      },
      notifications: {
        ...draft.notifications,
        quoteWarningDays: Math.max(1, Number(draft.notifications.quoteWarningDays) || 1),
      },
    })
    setSettings(next)
    notify('Configuración guardada correctamente')
  }

  const openUserForm = (user = null) => {
    setUserDraft(user ? { ...user, password: '', passwordConfirm: '', permissions: [...user.permissions] } : {
      id: null,
      username: '',
      name: '',
      email: '',
      password: '',
      passwordConfirm: '',
      role: 'Vendedor',
      active: true,
      permissions: [...rolePermissions.Vendedor],
    })
  }

  const updateUserRole = (role) => setUserDraft((current) => ({ ...current, role, permissions: [...rolePermissions[role]] }))

  const toggleUserPermission = (permission) => {
    setUserDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission) ? current.permissions.filter((item) => item !== permission) : [...current.permissions, permission],
    }))
  }

  const saveUser = async (event) => {
    event.preventDefault()
    const normalizedDraftUsername = normalizeUsername(userDraft.username)
    if (!/^[a-z0-9._-]{3,30}$/.test(normalizedDraftUsername)) {
      notify('El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo', 'warning')
      return
    }
    const usernameExists = users.some((user) => user.id !== userDraft.id && getUsername(user) === normalizedDraftUsername)
    if (usernameExists) {
      notify('Ya existe una cuenta con ese nombre de usuario', 'warning')
      return
    }
    const emailExists = users.some((user) => user.id !== userDraft.id && user.email.toLowerCase() === userDraft.email.trim().toLowerCase())
    if (emailExists) {
      notify('Ya existe un usuario con ese correo', 'warning')
      return
    }
    if (userDraft.id === currentUser.id && (!userDraft.active || !userDraft.permissions.includes('settings') || !userDraft.permissions.includes('manageUsers'))) {
      notify('El usuario activo debe conservar acceso a usuarios y configuración', 'warning')
      return
    }
    const needsPassword = !userDraft.id || !userDraft.passwordHash
    if (needsPassword && !userDraft.password) {
      notify('Debes definir una contraseña inicial', 'warning')
      return
    }
    if (userDraft.password) {
      const validationError = passwordValidationMessage(userDraft.password)
      if (validationError) {
        notify(validationError, 'warning')
        return
      }
      if (userDraft.password !== userDraft.passwordConfirm) {
        notify('Las contraseñas no coinciden', 'warning')
        return
      }
    }
    setUserSaving(true)
    let credential = {}
    try {
      if (userDraft.password) credential = await createPasswordCredential(userDraft.password)
    } catch {
      notify('No fue posible proteger la contraseña en este navegador', 'warning')
      setUserSaving(false)
      return
    }
    const { password, passwordConfirm, showPassword, ...userData } = userDraft
    const savedUser = {
      ...userData,
      ...credential,
      id: userDraft.id || Math.max(0, ...users.map((user) => Number(user.id) || 0)) + 1,
      username: normalizedDraftUsername,
      name: userDraft.name.trim(),
      email: userDraft.email.trim().toLowerCase(),
      mustChangePassword: userDraft.password ? userDraft.id !== currentUser.id : Boolean(userDraft.mustChangePassword),
    }
    setUsers((current) => userDraft.id ? current.map((user) => user.id === userDraft.id ? savedUser : user) : [...current, savedUser])
    setUserSaving(false)
    setUserDraft(null)
    notify(userDraft.id ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente')
  }

  const exportBackup = () => {
    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      store: settings.business.name,
      data: { settings, products, customers, sales, receipts, dispatches, suppliers, heldSales, quotes, users, currentUserId: currentUser.id, readNotifications },
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `respaldo-los-nogales-${localDateKey()}.json`
    link.click()
    URL.revokeObjectURL(url)
    notify('Respaldo completo descargado')
  }

  const importBackup = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const backup = JSON.parse(await file.text())
      const data = backup.data
      if (!data || !Array.isArray(data.products) || !Array.isArray(data.sales)) throw new Error('invalid')
      const restoredSettings = normalizeSettings(data.settings)
      const restoredQuotes = Array.isArray(data.quotes) ? data.quotes : []
      if (!Array.isArray(restoredSettings.sales.paymentMethods) || !restoredSettings.sales.paymentMethods.length) throw new Error('invalid')
      setSettings(restoredSettings)
      setProducts(data.products)
      setCustomers(Array.isArray(data.customers) ? data.customers : [])
      setSales(data.sales)
      setReceipts(Array.isArray(data.receipts) ? data.receipts : [])
      setDispatches(Array.isArray(data.dispatches) ? data.dispatches : [])
      setSuppliers(Array.isArray(data.suppliers) ? data.suppliers : [])
      setHeldSales(Array.isArray(data.heldSales) ? data.heldSales : [])
      setQuotes(restoredQuotes)
      const restoredUsers = Array.isArray(data.users) && data.users.length ? data.users : defaultUsers
      setUsers(normalizeUsers(restoredUsers))
      setCurrentUserId(restoredUsers.some((user) => user.id === data.currentUserId && user.active) ? data.currentUserId : restoredUsers.find((user) => user.active)?.id || 1)
      setReadNotifications(data.readNotifications && typeof data.readNotifications === 'object' ? data.readNotifications : {})
      localStorage.setItem('mf-quote-sequence', String(Math.max(0, ...restoredQuotes.map((quote) => Number(quote.sequence) || 0))))
      notify('Respaldo restaurado correctamente')
    } catch {
      notify('El archivo no corresponde a un respaldo válido', 'warning')
    }
  }

  const restoreDefaults = () => {
    setSettings(defaultSettings)
    setDraft(defaultSettings)
    setProducts(defaultProducts)
    setCustomers(defaultCustomers)
    setSales(initialSales)
    setReceipts(initialReceipts)
    setDispatches(initialDispatches)
    setSuppliers(defaultSuppliers)
    setHeldSales(defaultHeldSales)
    setQuotes([])
    const preservedAdmin = { ...currentUser, role: 'Administrador', active: true, permissions: [...rolePermissions.Administrador], mustChangePassword: false }
    setUsers([preservedAdmin])
    setCurrentUserId(preservedAdmin.id)
    setReadNotifications({})
    localStorage.removeItem('mf-quote-sequence')
    localStorage.removeItem('mf-held-sale-sequence')
    setConfirmReset(false)
    notify('ERP restablecido sin datos operativos')
  }

  return (
    <div className="module-page settings-page">
      <div className="module-toolbar">
        <div><h2>Configuración</h2><p>Administra los datos y preferencias operativas de la ferretería.</p></div>
        {!['backup', 'users', 'initial-load'].includes(section) && <button className="primary-button" type="submit" form="settings-form"><Save size={18} />Guardar cambios</button>}
        {section === 'users' && <button className="primary-button" type="button" onClick={() => openUserForm()}><Plus size={18} />Nuevo usuario</button>}
      </div>

      <div className="settings-workspace">
        <nav className="settings-nav" aria-label="Secciones de configuración">
          {sections.map(({ id, label, detail, icon: Icon }) => (
            <button key={id} className={section === id ? 'active' : ''} onClick={() => { setSection(id); onSectionChange(id) }}>
              <span><Icon size={18} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={15} />
            </button>
          ))}
        </nav>

        <form id="settings-form" className="settings-content" onSubmit={saveSettings}>
          {section === 'business' && <>
            <SettingsHeading icon={Building2} title="Datos del negocio" text="Información visible en documentos y encabezados." />
            <div className="settings-form-grid">
              <label>Nombre comercial<input value={draft.business.name} onChange={(event) => updateSection('business', 'name', event.target.value)} required /></label>
              <label>Razón social<input value={draft.business.legalName} onChange={(event) => updateSection('business', 'legalName', event.target.value)} required /></label>
              <label>RUT<input value={draft.business.rut} onChange={(event) => updateSection('business', 'rut', event.target.value)} required /></label>
              <label>Sucursal<input value={draft.business.branch} onChange={(event) => updateSection('business', 'branch', event.target.value)} required /></label>
              <label className="settings-span-2">Dirección<input value={draft.business.address} onChange={(event) => updateSection('business', 'address', event.target.value)} required /></label>
              <label>Teléfono<input value={draft.business.phone} onChange={(event) => updateSection('business', 'phone', event.target.value)} required /></label>
              <label>Correo<input type="email" value={draft.business.email} onChange={(event) => updateSection('business', 'email', event.target.value)} required /></label>
            </div>
          </>}

          {section === 'sales' && <>
            <SettingsHeading icon={ShoppingCart} title="Ventas y caja" text="Parámetros utilizados al cobrar y emitir una boleta." />
            <div className="settings-form-grid">
              <label>Nombre de caja<input value={draft.sales.register} onChange={(event) => updateSection('sales', 'register', event.target.value)} required /></label>
              <label>Medio de pago predeterminado<select value={draft.sales.defaultPayment} onChange={(event) => updateSection('sales', 'defaultPayment', event.target.value)}>{draft.sales.paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
            </div>
            <div className="settings-subsection">
              <div><strong>Medios de pago habilitados</strong><small>Disponibles en el punto de venta</small></div>
              <div className="payment-options">
                {defaultSettings.sales.paymentMethods.map((method) => <label key={method}><input type="checkbox" checked={draft.sales.paymentMethods.includes(method)} onChange={() => togglePayment(method)} /><span>{method}</span></label>)}
              </div>
            </div>
          </>}

          {section === 'documents' && <>
            <SettingsHeading icon={FileText} title="Documentos" text="Numeración, vigencia y contenido de impresión." />
            <div className="settings-form-grid">
              <label>Próximo folio de venta<input type="number" min="1" value={draft.documents.saleSequence} onChange={(event) => updateSection('documents', 'saleSequence', event.target.value)} required /></label>
              <label>Próximo correlativo de cotización<input type="number" min="1" value={draft.documents.quoteSequence} onChange={(event) => updateSection('documents', 'quoteSequence', event.target.value)} required /></label>
              <label>Vigencia de cotizaciones<input type="number" min="1" value={draft.documents.quoteValidityDays} onChange={(event) => updateSection('documents', 'quoteValidityDays', event.target.value)} required /><small>Días corridos</small></label>
              <label>Formato de boleta<select value={draft.documents.receiptFormat} onChange={(event) => updateSection('documents', 'receiptFormat', event.target.value)}><option>Térmica 80 mm</option><option>Carta</option></select></label>
              <label className="settings-span-2">Pie de boleta<textarea rows="3" value={draft.documents.receiptFooter} onChange={(event) => updateSection('documents', 'receiptFooter', event.target.value)} /></label>
              <label className="settings-span-2">Pie de cotización<textarea rows="3" value={draft.documents.quoteFooter} onChange={(event) => updateSection('documents', 'quoteFooter', event.target.value)} /></label>
            </div>
          </>}

          {section === 'inventory' && <>
            <SettingsHeading icon={Boxes} title="Inventario" text="Reglas de stock y opciones para crear productos." />
            <div className="settings-form-grid">
              <label>Stock mínimo predeterminado<input type="number" min="0" value={draft.inventory.defaultMinStock} onChange={(event) => updateSection('inventory', 'defaultMinStock', event.target.value)} required /><small>Aplicado a productos nuevos</small></label>
              <label className="settings-span-2">Categorías<input value={draft.inventory.categories} onChange={(event) => updateSection('inventory', 'categories', event.target.value)} required /><small>Separadas por comas</small></label>
              <label className="settings-span-2">Unidades de medida<input value={draft.inventory.units} onChange={(event) => updateSection('inventory', 'units', event.target.value)} required /><small>Separadas por comas</small></label>
            </div>
            <div className="settings-toggle-list">
              <SettingToggle checked={draft.inventory.lowStockAlerts} onChange={(value) => updateSection('inventory', 'lowStockAlerts', value)} title="Alertas de stock bajo" text="Destaca productos que alcanzan su stock mínimo." />
              <SettingToggle checked={draft.inventory.preventNegative} onChange={(value) => updateSection('inventory', 'preventNegative', value)} title="Impedir stock negativo" text="Bloquea ventas y despachos superiores a las existencias." />
            </div>
          </>}

          {section === 'notifications' && <>
            <SettingsHeading icon={Bell} title="Notificaciones" text="Define qué alertas mostrará el sistema en la campana." />
            <div className="settings-toggle-list notification-preferences">
              <SettingToggle checked={draft.notifications.lowStock} onChange={(value) => updateSection('notifications', 'lowStock', value)} title="Stock bajo" text="Avisa cuando uno o más productos alcanzan su nivel mínimo." />
              <SettingToggle checked={draft.notifications.pendingDispatches} onChange={(value) => updateSection('notifications', 'pendingDispatches', value)} title="Despachos pendientes" text="Muestra pedidos que todavía están en preparación." />
              <SettingToggle checked={draft.notifications.expiringQuotes} onChange={(value) => updateSection('notifications', 'expiringQuotes', value)} title="Cotizaciones por vencer" text="Advierte sobre cotizaciones cercanas a su fecha de vencimiento." />
              <SettingToggle checked={draft.notifications.dailySalesSummary} onChange={(value) => updateSection('notifications', 'dailySalesSummary', value)} title="Resumen diario de ventas" text="Informa la cantidad y el total vendido durante el día." />
            </div>
            <div className="notification-threshold">
              <label>Días de anticipación<input type="number" min="1" max="60" value={draft.notifications.quoteWarningDays} disabled={!draft.notifications.expiringQuotes} onChange={(event) => updateSection('notifications', 'quoteWarningDays', event.target.value)} /><small>Para cotizaciones por vencer</small></label>
              <div><Bell size={18} /><span><strong>Alertas individuales</strong><small>El estado leído se guarda por usuario.</small></span></div>
            </div>
          </>}

          {section === 'users' && <>
            <SettingsHeading icon={Users} title="Usuarios y permisos" text="Controla el acceso de cada integrante del equipo." />
            <div className="users-summary">
              <div><span>Usuarios</span><strong>{users.length}</strong></div>
              <div><span>Activos</span><strong>{users.filter((user) => user.active).length}</strong></div>
              <div><span>Administradores</span><strong>{users.filter((user) => user.active && user.role === 'Administrador').length}</strong></div>
            </div>
            <div className="users-list">
              <div className="users-list-head"><span>Usuario</span><span>Rol</span><span>Estado</span><span /></div>
              {users.map((user) => <div className="user-row" key={user.id}>
                <span className="user-identity"><i className={`avatar ${user.active ? '' : 'inactive'}`}>{userInitials(user.name)}</i><span><strong>{user.name}</strong><small>@{getUsername(user)} · {user.email}{user.id === currentUser.id ? ' · Usuario activo' : ''}{!user.passwordHash ? ' · Sin contraseña' : user.mustChangePassword ? ' · Cambio pendiente' : ''}</small></span></span>
                <span className="role-badge">{user.role}</span>
                <span className={`user-status ${user.active ? 'active' : ''}`}><i />{user.active ? 'Activo' : 'Bloqueado'}</span>
                <button type="button" className="row-action" onClick={() => openUserForm(user)}><Pencil size={14} />Editar</button>
              </div>)}
            </div>
          </>}

          {section === 'initial-load' && <InitialLoadPanel products={products} setProducts={setProducts} customers={customers} setCustomers={setCustomers} suppliers={suppliers} setSuppliers={setSuppliers} setSettings={setSettings} notify={notify} />}

          {section === 'backup' && <>
            <SettingsHeading icon={Box} title="Respaldo y restauración" text="Protege la información almacenada en este equipo." />
            <div className="backup-summary">
              <div><span>Productos</span><strong>{number.format(products.length)}</strong></div>
              <div><span>Ventas</span><strong>{number.format(sales.length)}</strong></div>
              <div><span>Proveedores</span><strong>{number.format(suppliers.length)}</strong></div>
              <div><span>Movimientos</span><strong>{number.format(receipts.length + dispatches.length)}</strong></div>
            </div>
            <div className="backup-actions">
              <button type="button" onClick={exportBackup}><span><Download size={20} /></span><span><strong>Descargar respaldo</strong><small>Exporta configuración y registros en formato JSON</small></span><ArrowRight size={16} /></button>
              <button type="button" onClick={() => importRef.current?.click()}><span><Upload size={20} /></span><span><strong>Restaurar respaldo</strong><small>Importa un archivo generado por este sistema</small></span><ArrowRight size={16} /></button>
              <button type="button" className="danger" onClick={() => setConfirmReset(true)}><span><RotateCcw size={20} /></span><span><strong>Vaciar datos del ERP</strong><small>Elimina los registros operativos y restablece la configuración</small></span><ArrowRight size={16} /></button>
              <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importBackup} />
            </div>
          </>}
        </form>
      </div>

      {confirmReset && <Modal title="Vaciar datos del ERP" subtitle="Esta acción eliminará los registros actuales" onClose={() => setConfirmReset(false)}>
        <div className="reset-confirm"><AlertTriangle size={24} /><p>Descarga un respaldo antes de continuar si necesitas conservar tus ventas, productos o proveedores.</p></div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setConfirmReset(false)}>Cancelar</button><button className="danger-button confirm" onClick={restoreDefaults}><RotateCcw size={16} />Confirmar restauración</button></div>
      </Modal>}
      {userDraft && <Modal title={userDraft.id ? 'Editar usuario' : 'Nuevo usuario'} subtitle="Perfil de acceso al sistema" onClose={() => setUserDraft(null)} wide>
        <form className="user-form" onSubmit={saveUser}>
          <div className="form-grid">
            <label>Nombre de usuario<input value={userDraft.username} onChange={(event) => setUserDraft((current) => ({ ...current, username: event.target.value }))} required autoComplete="off" placeholder="nombre.usuario" /><small>Se utilizará para iniciar sesión</small></label>
            <label>Nombre completo<input value={userDraft.name} onChange={(event) => setUserDraft((current) => ({ ...current, name: event.target.value }))} required /></label>
            <label>Correo electrónico<input type="email" value={userDraft.email} onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))} required /></label>
            <label>{userDraft.id ? 'Nueva contraseña' : 'Contraseña inicial'}<span className="password-input"><input type={userDraft.showPassword ? 'text' : 'password'} value={userDraft.password} onChange={(event) => setUserDraft((current) => ({ ...current, password: event.target.value }))} required={!userDraft.id || !userDraft.passwordHash} autoComplete="new-password" placeholder={userDraft.id ? 'Dejar en blanco para conservar' : 'Mínimo 8 caracteres'} /><button type="button" onClick={() => setUserDraft((current) => ({ ...current, showPassword: !current.showPassword }))} aria-label={userDraft.showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{userDraft.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span><small>Mayúscula, minúscula y número</small></label>
            <label>Confirmar contraseña<input type={userDraft.showPassword ? 'text' : 'password'} value={userDraft.passwordConfirm} onChange={(event) => setUserDraft((current) => ({ ...current, passwordConfirm: event.target.value }))} required={Boolean(userDraft.password)} autoComplete="new-password" placeholder="Repite la contraseña" /></label>
            <label>Rol<select value={userDraft.role} onChange={(event) => updateUserRole(event.target.value)}>{Object.keys(rolePermissions).map((role) => <option key={role}>{role}</option>)}</select></label>
            <label className="user-active-field"><span>Estado de acceso</span><span className="inline-switch"><input type="checkbox" checked={userDraft.active} disabled={userDraft.id === currentUser.id} onChange={(event) => setUserDraft((current) => ({ ...current, active: event.target.checked }))} /><i /><strong>{userDraft.active ? 'Activo' : 'Bloqueado'}</strong></span></label>
          </div>
          <div className="permission-editor">
            <PermissionGroup title="Acceso a módulos" permissions={modulePermissions} userDraft={userDraft} currentUser={currentUser} togglePermission={toggleUserPermission} />
            <PermissionGroup title="Acciones autorizadas" permissions={actionPermissions} userDraft={userDraft} currentUser={currentUser} togglePermission={toggleUserPermission} />
          </div>
          <div className="modal-actions"><button type="button" className="secondary-button" disabled={userSaving} onClick={() => setUserDraft(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={userSaving}><Check size={17} />{userSaving ? 'Protegiendo acceso...' : 'Guardar usuario'}</button></div>
        </form>
      </Modal>}
    </div>
  )
}

function InitialLoadPanel({ products, setProducts, customers, setCustomers, suppliers, setSuppliers, setSettings, notify }) {
  const uploadRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [reading, setReading] = useState(false)
  const [downloading, setDownloading] = useState(null)

  const downloadTemplate = async (templateId = 'all') => {
    setDownloading(templateId)
    try {
      const { default: writeExcelFile } = await import('write-excel-file/browser')
      const selectedIds = templateId === 'all' ? initialLoadTemplates.map(({ id }) => id) : [templateId]
      const template = initialLoadTemplates.find(({ id }) => id === templateId)
      const fileName = templateId === 'all' ? 'plantilla-carga-inicial-erp.xlsx' : `plantilla-${template.sheet.toLowerCase()}.xlsx`
      await writeExcelFile(createInitialLoadSheets(selectedIds), { fontFamily: 'Arial', fontSize: 10 }).toFile(fileName)
      notify(templateId === 'all' ? 'Plantilla completa descargada' : `Plantilla de ${template.label.toLowerCase()} descargada`)
    } catch {
      notify('No fue posible generar la plantilla Excel', 'warning')
    } finally {
      setDownloading(null)
    }
  }

  const readInitialLoad = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setReading(true)
    setPreview(null)
    try {
      const { default: readExcelFile } = await import('read-excel-file/browser')
      const sheets = await readExcelFile(file)
      const result = parseInitialLoadWorkbook(sheets, { products, customers, suppliers })
      setPreview({ ...result, fileName: file.name })
    } catch {
      setPreview({
        fileName: file.name,
        datasets: { products: [], customers: [], suppliers: [], inventory: [] },
        summary: Object.fromEntries(initialLoadTemplates.map(({ id }) => [id, { rows: 0, creates: 0, updates: 0 }])),
        totalRows: 0,
        sheets: [],
        errors: [{ sheet: 'Archivo', row: null, message: 'El archivo no es un Excel .xlsx válido o está dañado.' }],
      })
    } finally {
      setReading(false)
    }
  }

  const confirmInitialLoad = () => {
    if (!preview || preview.errors.length || !preview.totalRows) return
    const merged = mergeInitialLoad(preview, { products, customers, suppliers })
    setProducts(merged.products)
    setCustomers(merged.customers)
    setSuppliers(merged.suppliers)

    const importedCategories = preview.datasets.products.map((product) => product.category).filter(Boolean)
    if (importedCategories.length) {
      setSettings((current) => ({
        ...current,
        inventory: {
          ...current.inventory,
          categories: [...new Set([...splitList(current.inventory.categories), ...importedCategories])].join(', '),
        },
      }))
    }

    notify(`${preview.totalRows} registros procesados correctamente`)
    setPreview(null)
  }

  return <>
    <SettingsHeading icon={Upload} title="Carga inicial" text="Descarga plantillas Excel, complétalas y valida la información antes de incorporarla." />

    <div className="initial-load-notice">
      <FileSpreadsheet size={20} />
      <span><strong>Comienza con la plantilla completa</strong><small>Incluye productos, clientes, proveedores y existencias. Los usuarios, ventas y movimientos históricos no se importan desde esta sección.</small></span>
      <button type="button" className="primary-button" disabled={Boolean(downloading)} onClick={() => downloadTemplate('all')}><Download size={17} />{downloading === 'all' ? 'Generando...' : 'Descargar plantilla completa'}</button>
    </div>

    <div className="initial-load-templates">
      {initialLoadTemplates.map((template) => <article key={template.id}>
        <span><FileSpreadsheet size={20} /></span>
        <div><h4>{template.label}</h4><p>{template.description}</p><small>Clave de actualización: {template.keyLabel}</small></div>
        <button type="button" className="secondary-button" disabled={Boolean(downloading)} onClick={() => downloadTemplate(template.id)}><Download size={15} />{downloading === template.id ? 'Generando...' : 'Plantilla'}</button>
      </article>)}
    </div>

    <section className="initial-load-upload">
      <div><span><Upload size={22} /></span><div><h4>Subir archivo completado</h4><p>Formato admitido: Excel (.xlsx). Puedes cargar una sola hoja o el archivo completo.</p></div></div>
      <button type="button" className="primary-button" disabled={reading} onClick={() => uploadRef.current?.click()}>{reading ? 'Leyendo archivo...' : 'Seleccionar archivo'}</button>
      <input ref={uploadRef} className="visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={readInitialLoad} />
    </section>

    {preview && <section className={`initial-load-preview ${preview.errors.length ? 'has-errors' : ''}`}>
      <div className="initial-load-preview-head">
        <div><span className={preview.errors.length ? 'warning' : 'success'}>{preview.errors.length ? <AlertTriangle size={18} /> : <Check size={18} />}</span><div><h4>{preview.errors.length ? 'El archivo necesita correcciones' : 'Archivo listo para importar'}</h4><p>{preview.fileName} · {preview.totalRows} filas válidas</p></div></div>
        <button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label="Cerrar vista previa"><X size={18} /></button>
      </div>

      <div className="initial-load-summary">
        {initialLoadTemplates.map((template) => {
          const summary = preview.summary[template.id]
          const included = preview.sheets.includes(template.id)
          return <div key={template.id} className={included ? '' : 'muted'}><span>{template.label}</span><strong>{summary.rows}</strong><small>{included ? `${summary.creates} nuevos · ${summary.updates} actualizaciones` : 'Hoja no incluida'}</small></div>
        })}
      </div>

      {!!preview.errors.length && <div className="initial-load-errors">
        <strong>{preview.errors.length} {preview.errors.length === 1 ? 'error encontrado' : 'errores encontrados'}</strong>
        <div>{preview.errors.slice(0, 12).map((error, index) => <p key={`${error.sheet}-${error.row}-${index}`}><span>{error.sheet}{error.row ? ` · fila ${error.row}` : ''}</span>{error.message}</p>)}</div>
        {preview.errors.length > 12 && <small>Hay {preview.errors.length - 12} errores adicionales. Corrige el archivo y vuelve a cargarlo.</small>}
      </div>}

      {!preview.errors.length && !preview.totalRows && <div className="initial-load-empty"><AlertTriangle size={18} /><span><strong>El archivo no contiene filas para importar</strong><small>Completa al menos una fila bajo los encabezados y vuelve a cargarlo.</small></span></div>}

      <div className="initial-load-actions">
        <button type="button" className="secondary-button" onClick={() => setPreview(null)}>Cancelar</button>
        <button type="button" className="primary-button" disabled={Boolean(preview.errors.length) || !preview.totalRows} onClick={confirmInitialLoad}><Upload size={16} />Confirmar carga</button>
      </div>
    </section>}
  </>
}

function SettingsHeading({ icon: Icon, title, text }) {
  return <header className="settings-heading"><span><Icon size={20} /></span><div><h3>{title}</h3><p>{text}</p></div></header>
}

function SettingToggle({ checked, onChange, title, text }) {
  return <label className="setting-toggle"><span><strong>{title}</strong><small>{text}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>
}

function PermissionGroup({ title, permissions, userDraft, currentUser, togglePermission }) {
  return <section><h4>{title}</h4><div>{permissions.map((permission) => {
    const protectsCurrentUser = userDraft.id === currentUser.id && ['settings', 'manageUsers'].includes(permission.id)
    return <label key={permission.id}><input type="checkbox" checked={userDraft.permissions.includes(permission.id)} disabled={protectsCurrentUser} onChange={() => togglePermission(permission.id)} /><span><Check size={13} /></span><strong>{permission.label}</strong></label>
  })}</div></section>
}

function ProductThumb({ product, compact = false }) {
  return <span className={`product-thumb ${product.tone} ${compact ? 'compact' : ''}`}><Hammer size={compact ? 18 : 27} strokeWidth={1.8} /><small>{product.sku.split('-')[0]}</small></span>
}

function EmptyState({ icon: Icon, title, text }) {
  return <div className="empty-state"><span><Icon size={24} /></span><strong>{title}</strong><p>{text}</p></div>
}

function Modal({ title, subtitle, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true"><div className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button></div>{children}</div></div>
}

export default App
