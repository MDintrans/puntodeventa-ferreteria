# Base de datos en Neon

El ERP usa PostgreSQL en Neon. El esquema versionado está en
`neon/migrations` y se instala con los comandos del propio proyecto.

La aplicación web no debe conectarse directamente a PostgreSQL: la cadena
`DATABASE_URL` entrega acceso completo y debe permanecer exclusivamente en el
servidor o API. Nunca debe renombrarse como `VITE_DATABASE_URL`.

## Qué incluye el esquema

- Organizaciones, sucursales, usuarios, sesiones y roles (`admin`, `seller`,
  `warehouse`).
- Productos, categorías, clientes y proveedores.
- Existencias por sucursal, reservas e historial de movimientos.
- Ventas, detalle, medios de pago y ventas en espera.
- Cajas, aperturas, cierres y movimientos de efectivo.
- Ingresos de mercadería, despachos y cotizaciones.
- Devoluciones de venta y reintegro de inventario.
- Cargas iniciales, errores por fila y auditoría.
- Folios atómicos por sucursal y tipo de documento.
- Configuración del negocio y notificaciones leídas.

En total se crean 34 tablas, 6 funciones transaccionales y 2 vistas. Ventas,
productos, existencias, ingresos y despachos se guardan en sus tablas
normalizadas. `erp_state_snapshots` conserva únicamente configuración y
catálogos auxiliares de la interfaz; no es la fuente de verdad del stock.
Los montos se almacenan como pesos chilenos enteros (`bigint`) y las cantidades
usan tres decimales para admitir unidades como metros o kilos.

## Crear y configurar el proyecto

1. Crear un proyecto en la consola de Neon y seleccionar la región más próxima
   al despliegue de la API.
2. Abrir **Connect**, dejar habilitada la conexión **Pooled** y copiar la cadena
   PostgreSQL completa.
3. Crear el archivo local de secretos:

   ```powershell
   Copy-Item .env.example .env.local
   ```

4. Reemplazar el valor de `DATABASE_URL` en `.env.local`. Este archivo está
   ignorado por Git y no se debe compartir ni subir al repositorio.

## Crear todas las tablas

Desde la raíz del proyecto:

```powershell
npm install
npm run db:validate
npm run db:migrate
npm run api:validate
npm run transactions:validate
npm run ui:validate
```

`db:validate` levanta PostgreSQL en memoria y comprueba la sintaxis, relaciones,
creación inicial, protección del último administrador y ajuste de inventario sin
necesitar credenciales de Neon.

`api:validate` comprueba contra Neon el bootstrap, bcrypt, las sesiones y el
estado auxiliar sincronizado dentro de una transacción que siempre se revierte,
por lo que no deja datos de prueba.

`transactions:validate` crea una organización temporal, hace competir dos
cajas por la última unidad, prueba reintentos de venta, ingreso y despacho, y
elimina los datos temporales al finalizar.

`ui:validate` abre Chrome en modo headless, inicia sesión en una organización
temporal, crea una segunda caja y vende desde dos terminales (escritorio y
móvil). También comprueba que el stock actualizado por una terminal aparezca en
la otra. Los datos temporales se eliminan al finalizar.

El ejecutor registra cada archivo en `public.schema_migrations`, guarda su hash
y ejecuta cada migración dentro de una transacción. Es seguro volver a ejecutar
el comando: una migración ya aplicada se omite. Una migración aplicada nunca se
edita; los cambios siguientes se agregan como un nuevo archivo SQL.

Para comprobar una base existente:

```powershell
npm run db:verify
```

La validación exige que estén presentes las 34 tablas ERP, las 6 funciones, las
2 vistas y el historial de migraciones.

## Estado inicial

La migración deja vacíos productos, clientes, proveedores, existencias y
documentos. Tampoco crea contraseñas ni usuarios de demostración.

La función `bootstrap_business` crea únicamente la organización, la Casa Matriz,
la membresía de administrador, los folios, la caja principal y la configuración
básica. Recibe el identificador de un usuario ya creado por la API:

```sql
select * from public.bootstrap_business(
  'ID-UUID-DEL-USUARIO',
  'Ferretería Los Nogales',
  'Casa Matriz',
  null
);
```

Las contraseñas se guardan únicamente como hash bcrypt en
`app_users.password_hash`. El alta y el inicio de sesión se realizan desde la
API privada del ERP; el hash nunca se envía al navegador. Las sesiones usan una
cookie `HttpOnly` y se registran en `user_sessions`.

## Operaciones transaccionales

El navegador nunca modifica existencias directamente. La API bloquea las filas
de `branch_inventory`, valida el stock disponible y guarda documento, detalle,
pago y movimiento de stock dentro de una sola transacción PostgreSQL.

- `POST /api/sales`: crea la venta, la asocia a una caja, descuenta stock y
  registra el pago.
- `POST /api/receipts`: crea el ingreso, actualiza costo y suma existencias.
- `POST /api/dispatches`: crea el despacho y reserva existencias.
- `PATCH /api/dispatches/:id/advance`: materializa la salida o confirma la
  entrega sin avanzar dos etapas por un doble clic.
- `POST`/`PATCH /api/products`: crea o ajusta productos con bloqueo de stock.

Ventas, ingresos y despachos incluyen una clave de idempotencia: repetir la
misma solicitud por un corte de red devuelve el documento original sin volver
a mover inventario. Las líneas se bloquean en orden estable, de modo que dos
cajas pueden operar simultáneamente sin sobreventa.

Para ajustes administrativos también está disponible `adjust_inventory`, que
bloquea la fila, valida el rol y registra el movimiento:

```sql
select * from public.adjust_inventory(
  'ID-UUID-DEL-USUARIO',
  'ID-UUID-DE-LA-SUCURSAL',
  'ID-UUID-DEL-PRODUCTO',
  25,
  'Stock inicial'
);
```

`product_stock` entrega el catálogo con stock físico, reservado y disponible.
`inventory_valuation` entrega la valorización por sucursal.

## Sincronización con la interfaz

La interfaz ya no utiliza `localStorage` como fuente de datos. Después del
inicio de sesión carga el estado de la organización desde Neon y envía los
cambios a `PATCH /api/state`. Los cambios se agrupan durante unos milisegundos y
la cabecera del ERP muestra si Neon está sincronizado, guardando o desconectado.

El servidor Node usa `DATABASE_URL`; el navegador sólo consume endpoints del
mismo origen bajo `/api`. Productos, ventas, ingresos y despachos se refrescan
desde sus tablas cada 15 segundos y al volver a enfocar la ventana. Clientes,
proveedores, cotizaciones, ventas en espera, configuración y notificaciones se
conservan en `erp_state_snapshots`. Usuarios, membresías, sesiones y auditoría
usan sus tablas relacionales dedicadas.

## Varias cajas

Cada sucursal puede tener varias filas en `cash_registers`. Un administrador
puede agregar otra desde **Configuración > Ventas y caja** y cada navegador
elige su caja en el punto de venta. Esa selección queda guardada sólo para la
terminal/pestaña actual, mientras todas las cajas comparten el stock confirmado
por Neon. Cada venta conserva `cash_register_id` para reportes y conciliación
posterior.

## Primer inicio

Con la base vacía, el login muestra **Configura el acceso inicial**. El usuario
propuesto es `matias`; al definir su contraseña, la API crea en una única
transacción el administrador, la organización, Casa Matriz, caja, folios,
configuración inicial y estado sincronizado. No se crean credenciales de prueba.

## Despliegue en Render

El archivo `render.yaml` configura el servicio web, la compilación, las
migraciones y el health check. En Render sólo debes cargar `DATABASE_URL` como
variable secreta. El despliegue ejecuta:

```powershell
npm ci
npm run build
npm run db:migrate
npm start
```

`/api/health` responde correctamente sólo cuando el servidor puede consultar
Neon. En producción la cookie de sesión se marca `Secure` y `HttpOnly`.
