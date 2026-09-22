const headerCell = (value) => ({
  value,
  fontWeight: 'bold',
  backgroundColor: '#0f5f5a',
  textColor: '#ffffff',
  align: 'center',
})

const instructionTitle = (value) => ({
  value,
  fontWeight: 'bold',
  fontSize: 16,
  textColor: '#163f3b',
})

export const initialLoadTemplates = [
  {
    id: 'products',
    sheet: 'Productos',
    label: 'Productos',
    description: 'Catálogo, precios, costos y stock mínimo.',
    keyLabel: 'SKU',
    required: ['sku', 'nombre', 'categoria', 'unidad', 'costo', 'precio_venta', 'stock_minimo'],
    headers: ['sku', 'codigo_barras', 'nombre', 'categoria', 'marca', 'unidad', 'costo', 'precio_venta', 'stock_minimo', 'activo'],
    widths: [16, 18, 34, 22, 20, 12, 14, 16, 16, 12],
    example: 'FER-001 | 780000000001 | Martillo carpintero | Herramientas | Stanley | un | 7000 | 11990 | 5 | SI',
  },
  {
    id: 'customers',
    sheet: 'Clientes',
    label: 'Clientes',
    description: 'Datos comerciales y de contacto de clientes.',
    keyLabel: 'RUT o nombre',
    required: ['nombre'],
    headers: ['rut', 'nombre', 'tipo', 'nombre_contacto', 'telefono', 'correo', 'direccion', 'comuna', 'limite_credito', 'notas', 'activo'],
    widths: [16, 32, 14, 25, 18, 30, 34, 20, 18, 36, 12],
    example: '76.123.456-7 | Constructora Ejemplo SpA | empresa | Ana Pérez | +56 9 1234 5678 | compras@ejemplo.cl | Av. Central 123 | Santiago | 500000 | Cliente mayorista | SI',
  },
  {
    id: 'suppliers',
    sheet: 'Proveedores',
    label: 'Proveedores',
    description: 'Contactos, condiciones de pago y entrega.',
    keyLabel: 'RUT o razón social',
    required: ['razon_social'],
    headers: ['rut', 'razon_social', 'rubro', 'nombre_contacto', 'cargo_contacto', 'telefono', 'correo', 'direccion', 'sitio_web', 'condicion_pago', 'plazo_entrega', 'notas', 'favorito', 'activo'],
    widths: [16, 32, 24, 24, 22, 18, 30, 34, 28, 20, 18, 36, 12, 12],
    example: '77.123.456-8 | Distribuidora Ejemplo SpA | Fijaciones | Luis Soto | Ejecutivo | +56 9 8765 4321 | ventas@ejemplo.cl | Calle Norte 456 | www.ejemplo.cl | 30 días | 2 a 3 días | Pedido mínimo $100.000 | NO | SI',
  },
  {
    id: 'inventory',
    sheet: 'Existencias',
    label: 'Existencias',
    description: 'Stock inicial y ubicación, relacionado mediante SKU.',
    keyLabel: 'SKU',
    required: ['sku', 'stock'],
    headers: ['sku', 'stock', 'ubicacion'],
    widths: [18, 16, 22],
    example: 'FER-001 | 25 | A-01-01',
  },
]

const normalizeToken = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')

const normalizeSku = (value) => String(value ?? '').trim().toUpperCase()
const normalizeRut = (value) => String(value ?? '').replace(/[^0-9Kk]/g, '').toUpperCase()
const normalizeName = (value) => String(value ?? '').trim().toLocaleLowerCase('es-CL')

const makeInstructionSheet = (templates) => ({
  sheet: 'Instrucciones',
  columns: [{ width: 28 }, { width: 105 }],
  data: [
    [instructionTitle('Carga inicial del ERP')],
    [{ value: 'Uso', fontWeight: 'bold' }, 'Complete las hojas incluidas y cargue el mismo archivo desde Configuración > Carga inicial.'],
    [{ value: 'Encabezados', fontWeight: 'bold' }, 'No cambie, elimine ni agregue columnas. Las filas completamente vacías se ignoran.'],
    [{ value: 'Actualizaciones', fontWeight: 'bold' }, 'Un SKU o RUT existente actualiza el registro; uno nuevo crea un registro.'],
    [{ value: 'Existencias', fontWeight: 'bold' }, 'La columna stock reemplaza la existencia actual del SKU. Importe Productos antes de Existencias o incluya ambas hojas.'],
    [{ value: 'Valores lógicos', fontWeight: 'bold' }, 'Use SI o NO en las columnas activo y favorito.'],
    [{ value: 'Montos', fontWeight: 'bold' }, 'Ingrese números sin símbolo $ ni separadores de miles.'],
    [],
    ...templates.flatMap((template) => [
      [{ value: template.label, fontWeight: 'bold', textColor: '#0f5f5a' }, `Clave: ${template.keyLabel}. Obligatorios: ${template.required.join(', ')}. Columnas: ${template.headers.join(', ')}`],
      ['Ejemplo', template.example],
    ]),
  ],
})

export const createInitialLoadSheets = (templateIds = initialLoadTemplates.map(({ id }) => id)) => {
  const selected = initialLoadTemplates.filter(({ id }) => templateIds.includes(id))
  return [
    makeInstructionSheet(selected),
    ...selected.map((template) => ({
      sheet: template.sheet,
      stickyRowsCount: 1,
      columns: template.widths.map((width) => ({ width })),
      data: [template.headers.map((header) => headerCell(template.required.includes(header) ? `${header} *` : header))],
    })),
  ]
}

const parseText = (value) => String(value ?? '').trim()

const parseNumberValue = (value, label, rowErrors, { integer = false, min = 0, required = true } = {}) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (required) rowErrors.push(`${label} es obligatorio`)
    return required ? null : 0
  }
  const normalized = typeof value === 'number'
    ? value
    : Number(String(value).trim().replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(normalized) || normalized < min || (integer && !Number.isInteger(normalized))) {
    rowErrors.push(`${label} debe ser ${integer ? 'un entero' : 'un número'} mayor o igual a ${min}`)
    return null
  }
  return normalized
}

const parseBooleanValue = (value, label, rowErrors, fallback = true) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback
  if (typeof value === 'boolean') return value
  const normalized = normalizeToken(value)
  if (['si', 'true', '1', 'activo'].includes(normalized)) return true
  if (['no', 'false', '0', 'inactivo'].includes(normalized)) return false
  rowErrors.push(`${label} debe indicar SI o NO`)
  return fallback
}

const requiredText = (row, key, label, rowErrors) => {
  const value = parseText(row[key])
  if (!value) rowErrors.push(`${label} es obligatorio`)
  return value
}

const optionalEmail = (value, rowErrors) => {
  const email = parseText(value).toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push('correo no tiene un formato válido')
  return email
}

const rowToObject = (headers, row) => Object.fromEntries(headers.map((header, index) => [header, row[index]]))
const hasRowData = (row) => row.some((value) => value !== null && value !== undefined && String(value).trim() !== '')

const parseProduct = (row, rowErrors) => ({
  sku: normalizeSku(requiredText(row, 'sku', 'sku', rowErrors)),
  barcode: parseText(row.codigo_barras),
  name: requiredText(row, 'nombre', 'nombre', rowErrors),
  category: requiredText(row, 'categoria', 'categoria', rowErrors),
  brand: parseText(row.marca),
  unit: requiredText(row, 'unidad', 'unidad', rowErrors),
  cost: parseNumberValue(row.costo, 'costo', rowErrors, { integer: true }),
  price: parseNumberValue(row.precio_venta, 'precio_venta', rowErrors, { integer: true }),
  minStock: parseNumberValue(row.stock_minimo, 'stock_minimo', rowErrors),
  active: parseBooleanValue(row.activo, 'activo', rowErrors),
})

const parseCustomer = (row, rowErrors) => {
  const customerType = normalizeToken(row.tipo || 'empresa')
  if (!['empresa', 'persona'].includes(customerType)) rowErrors.push('tipo debe ser empresa o persona')
  return {
    rut: parseText(row.rut),
    name: requiredText(row, 'nombre', 'nombre', rowErrors),
    customerType: customerType === 'persona' ? 'person' : 'company',
    contact: parseText(row.nombre_contacto),
    phone: parseText(row.telefono),
    email: optionalEmail(row.correo, rowErrors),
    address: parseText(row.direccion),
    commune: parseText(row.comuna),
    creditLimit: parseNumberValue(row.limite_credito, 'limite_credito', rowErrors, { integer: true, required: false }),
    notes: parseText(row.notas),
    active: parseBooleanValue(row.activo, 'activo', rowErrors),
  }
}

const parseSupplier = (row, rowErrors) => ({
  rut: parseText(row.rut),
  name: requiredText(row, 'razon_social', 'razon_social', rowErrors),
  category: parseText(row.rubro),
  contact: parseText(row.nombre_contacto),
  role: parseText(row.cargo_contacto),
  phone: parseText(row.telefono),
  email: optionalEmail(row.correo, rowErrors),
  address: parseText(row.direccion),
  website: parseText(row.sitio_web).replace(/^https?:\/\//i, ''),
  paymentTerms: parseText(row.condicion_pago),
  leadTime: parseText(row.plazo_entrega),
  notes: parseText(row.notas),
  favorite: parseBooleanValue(row.favorito, 'favorito', rowErrors, false),
  active: parseBooleanValue(row.activo, 'activo', rowErrors),
})

const parseInventory = (row, rowErrors) => ({
  sku: normalizeSku(requiredText(row, 'sku', 'sku', rowErrors)),
  stock: parseNumberValue(row.stock, 'stock', rowErrors),
  location: parseText(row.ubicacion),
})

const parsers = {
  products: parseProduct,
  customers: parseCustomer,
  suppliers: parseSupplier,
  inventory: parseInventory,
}

const recordKey = (type, record) => {
  if (['products', 'inventory'].includes(type)) return normalizeSku(record.sku)
  const rut = normalizeRut(record.rut)
  return rut || normalizeName(record.name)
}

const existingKeys = (type, existingData) => {
  if (type === 'products') return new Set(existingData.products.map((item) => normalizeSku(item.sku)))
  if (type === 'customers') return new Set(existingData.customers.map((item) => normalizeRut(item.rut) || normalizeName(item.name)))
  if (type === 'suppliers') return new Set(existingData.suppliers.map((item) => normalizeRut(item.rut) || normalizeName(item.name)))
  return new Set(existingData.products.map((item) => normalizeSku(item.sku)))
}

export const parseInitialLoadWorkbook = (sheets, existingData) => {
  const datasets = { products: [], customers: [], suppliers: [], inventory: [] }
  const errors = []
  const recognizedSheets = new Set()
  const sheetsByName = new Map(sheets.map((sheet) => [normalizeToken(sheet.sheet), sheet]))

  initialLoadTemplates.forEach((template) => {
    const sheet = sheetsByName.get(normalizeToken(template.sheet))
    if (!sheet) return
    recognizedSheets.add(template.id)
    const rows = sheet.data || []
    const headerValues = rows[0] || []
    const normalizedHeaders = headerValues.map(normalizeToken)
    const missingHeaders = template.headers.filter((header) => !normalizedHeaders.includes(header))
    if (missingHeaders.length) {
      errors.push({ sheet: template.sheet, row: 1, message: `Faltan columnas: ${missingHeaders.join(', ')}` })
      return
    }

    const orderedHeaders = normalizedHeaders
    const seen = new Set()
    rows.slice(1).forEach((row, index) => {
      if (!hasRowData(row)) return
      const sourceRow = index + 2
      const rowErrors = []
      const raw = rowToObject(orderedHeaders, row)
      const record = parsers[template.id](raw, rowErrors)
      const key = recordKey(template.id, record)
      if (key && seen.has(key)) rowErrors.push(`${template.keyLabel} está repetido dentro del archivo`)
      if (key) seen.add(key)
      if (rowErrors.length) {
        rowErrors.forEach((message) => errors.push({ sheet: template.sheet, row: sourceRow, message }))
        return
      }
      datasets[template.id].push({ ...record, sourceRow })
    })
  })

  if (!recognizedSheets.size) {
    errors.push({ sheet: 'Archivo', row: null, message: 'No contiene hojas reconocidas. Use las plantillas descargadas desde el ERP.' })
  }

  const availableProductSkus = new Set([
    ...existingData.products.map((product) => normalizeSku(product.sku)),
    ...datasets.products.map((product) => normalizeSku(product.sku)),
  ])
  datasets.inventory = datasets.inventory.filter((record) => {
    if (availableProductSkus.has(normalizeSku(record.sku))) return true
    errors.push({ sheet: 'Existencias', row: record.sourceRow, message: `El SKU ${record.sku} no existe en Productos ni en el sistema` })
    return false
  })

  const summary = {}
  for (const template of initialLoadTemplates) {
    const currentKeys = existingKeys(template.id, existingData)
    const records = datasets[template.id].map((record) => ({
      ...record,
      action: currentKeys.has(recordKey(template.id, record)) ? 'update' : 'create',
    }))
    datasets[template.id] = records
    summary[template.id] = {
      rows: records.length,
      creates: records.filter(({ action }) => action === 'create').length,
      updates: records.filter(({ action }) => action === 'update').length,
    }
  }

  return {
    datasets,
    errors,
    summary,
    totalRows: Object.values(datasets).reduce((total, records) => total + records.length, 0),
    sheets: [...recognizedSheets],
  }
}

const withoutImportMetadata = (record) => {
  const { sourceRow, action, ...data } = record
  return data
}

export const mergeInitialLoad = (preview, existingData) => {
  let idOffset = 0
  const nextId = () => Date.now() + idOffset++
  const products = [...existingData.products]
  const customers = [...existingData.customers]
  const suppliers = [...existingData.suppliers]

  preview.datasets.products.forEach((record) => {
    const data = withoutImportMetadata(record)
    const index = products.findIndex((item) => normalizeSku(item.sku) === normalizeSku(data.sku))
    const current = index >= 0 ? products[index] : null
    const product = {
      ...current,
      ...data,
      id: current?.id ?? nextId(),
      stock: current?.stock ?? 0,
      location: current?.location || '',
      tone: current?.tone || 'teal',
    }
    if (index >= 0) products[index] = product
    else products.push(product)
  })

  preview.datasets.customers.forEach((record) => {
    const data = withoutImportMetadata(record)
    const key = normalizeRut(data.rut) || normalizeName(data.name)
    const index = customers.findIndex((item) => (normalizeRut(item.rut) || normalizeName(item.name)) === key)
    const current = index >= 0 ? customers[index] : null
    const customer = {
      ...current,
      ...data,
      id: current?.id ?? nextId(),
      sales: current?.sales ?? 0,
      balance: current?.balance ?? 0,
      tone: current?.tone || 'teal',
    }
    if (index >= 0) customers[index] = customer
    else customers.push(customer)
  })

  preview.datasets.suppliers.forEach((record) => {
    const data = withoutImportMetadata(record)
    const key = normalizeRut(data.rut) || normalizeName(data.name)
    const index = suppliers.findIndex((item) => (normalizeRut(item.rut) || normalizeName(item.name)) === key)
    const current = index >= 0 ? suppliers[index] : null
    const supplier = {
      ...current,
      ...data,
      id: current?.id ?? nextId(),
      lastOrder: current?.lastOrder || 'Sin compras registradas',
      totalPurchases: current?.totalPurchases ?? 0,
      tone: current?.tone || 'teal',
    }
    if (index >= 0) suppliers[index] = supplier
    else suppliers.push(supplier)
  })

  preview.datasets.inventory.forEach((record) => {
    const index = products.findIndex((product) => normalizeSku(product.sku) === normalizeSku(record.sku))
    if (index >= 0) products[index] = { ...products[index], stock: record.stock, location: record.location }
  })

  return { products, customers, suppliers }
}
