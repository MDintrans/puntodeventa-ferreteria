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

En total se crean 33 tablas de negocio, 6 funciones transaccionales y 2 vistas.
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
```

`db:validate` levanta PostgreSQL en memoria y comprueba la sintaxis, relaciones,
creación inicial, protección del último administrador y ajuste de inventario sin
necesitar credenciales de Neon.

El ejecutor registra cada archivo en `public.schema_migrations`, guarda su hash
y ejecuta cada migración dentro de una transacción. Es seguro volver a ejecutar
el comando: una migración ya aplicada se omite. Una migración aplicada nunca se
edita; los cambios siguientes se agregan como un nuevo archivo SQL.

Para comprobar una base existente:

```powershell
npm run db:verify
```

La validación exige que estén presentes las 33 tablas ERP, las 6 funciones, las
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
`app_users.password_hash`. El alta y el inicio de sesión deben realizarse desde
la API del ERP; nunca se envía ese hash al navegador.

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

## Integración pendiente con la interfaz

La interfaz actual todavía conserva sus registros operacionales en
`localStorage`. Montar el esquema no mueve esos datos automáticamente. El paso
siguiente es agregar una API privada que maneje sesiones y traduzca las acciones
de los módulos a transacciones PostgreSQL. La API usará `DATABASE_URL`; el
navegador hablará sólo con endpoints HTTPS.
