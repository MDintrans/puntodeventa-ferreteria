# Base de datos

La primera versión usa PostgreSQL mediante Supabase. El esquema se encuentra en
`supabase/migrations` y está diseñado para una o más sucursales.

## Contenido

- Organizaciones, sucursales, perfiles y roles (`admin`, `seller`, `warehouse`).
- Productos, categorías, clientes y proveedores.
- Inventario por sucursal e historial inmutable de movimientos.
- Ventas, ingresos, despachos y cotizaciones con sus líneas de detalle.
- Folios independientes por sucursal y tipo de documento.
- Configuración del negocio y políticas Row Level Security.

Los montos se almacenan como pesos chilenos enteros. Las cantidades usan tres
decimales para permitir unidades como metros o kilos.

## Desarrollo local

Se necesita Docker Desktop (o un runtime compatible) y Supabase CLI.

```powershell
npx supabase start
npx supabase db reset
npx supabase status
```

`db reset` reconstruye la base aplicando todas las migraciones y luego
`supabase/seed.sql`. No debe ejecutarse contra una base de producción.

Copiar `.env.example` como `.env.local` y completar la clave publicable que
muestra `npx supabase status`. La clave `service_role` nunca debe incluirse en
variables `VITE_*` ni enviarse al navegador.

## Crear el primer negocio

1. Crear el primer usuario desde Supabase Auth/Studio.
2. Iniciar sesión con ese usuario desde la aplicación.
3. Ejecutar una vez la función RPC:

```js
const { data, error } = await supabase.rpc('bootstrap_business', {
  p_name: 'Ferretería Los Nogales',
  p_branch_name: 'Casa Matriz',
  p_rut: null,
})
```

La función crea la organización, la sucursal principal, la membresía de
administrador, las categorías iniciales y la configuración. Un usuario no puede
ejecutarla nuevamente después de pertenecer a una organización.

## Ingresar productos y stock inicial

El producto se inserta primero en `products`. El stock no se escribe directamente:
se registra mediante `adjust_inventory`, que actualiza la existencia y crea el
movimiento de auditoría en la misma transacción.

```js
await supabase.rpc('adjust_inventory', {
  p_branch_id: branchId,
  p_product_id: productId,
  p_quantity_delta: 25,
  p_reason: 'Stock inicial',
})
```

La vista `product_stock` entrega el catálogo junto con stock físico, reservado y
disponible. `inventory_valuation` entrega la valorización por sucursal.

## Proyecto remoto

Después de crear un proyecto de desarrollo en Supabase:

```powershell
npx supabase login
npx supabase link --project-ref ID_DEL_PROYECTO
npx supabase db push --dry-run
npx supabase db push
```

El siguiente paso del proyecto es reemplazar gradualmente `localStorage` por un
repositorio de datos Supabase, comenzando por autenticación, productos, clientes,
proveedores y stock. Las operaciones de venta/ingreso/despacho deben incorporarse
como funciones transaccionales antes de habilitar escritura multiusuario.
