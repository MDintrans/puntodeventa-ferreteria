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

En total se crean 34 tablas, 6 funciones transaccionales y 2 vistas. La tabla
`erp_state_snapshots` mantiene sincronizado el estado operativo utilizado por la
interfaz mientras los usuarios, sesiones y permisos permanecen normalizados.
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
```

`db:validate` levanta PostgreSQL en memoria y comprueba la sintaxis, relaciones,
creación inicial, protección del último administrador y ajuste de inventario sin
necesitar credenciales de Neon.

`api:validate` comprueba contra Neon el bootstrap, bcrypt, las sesiones y el
estado sincronizado dentro de una transacción que siempre se revierte, por lo
que no deja datos de prueba.

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

## Stock inicial

No se debe modificar `branch_inventory` manualmente. La API debe ejecutar
`adjust_inventory`, que bloquea la fila, valida el rol y registra el movimiento
en la misma transacción:

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
mismo origen bajo `/api`. Productos, ventas, ingresos, despachos, proveedores,
clientes, cotizaciones, ventas en espera, configuración y notificaciones se
conservan en `erp_state_snapshots`. Usuarios, membresías, sesiones y auditoría
usan sus tablas relacionales dedicadas.

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
