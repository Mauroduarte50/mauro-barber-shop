# ✂️ Sistema de Reservas para Barbería

Sistema web profesional de reservas y gestión de citas para barbería, construido con **Next.js (App Router) + TypeScript + PostgreSQL (Drizzle ORM) + Tailwind CSS**.

- **Página pública** (`/reservar`): el cliente elige servicio → fecha → hora → datos → confirmación, sin crear cuenta.
- **Panel del barbero** (`/admin`): dashboard, calendario (día/semana/mes), citas, clientes, servicios, horarios, bloqueos, ingresos, estadísticas, notificaciones y configuración.
- **Arquitectura multibarbero**: todas las tablas llevan `barber_id`; lista para agregar `business_id` y convertirse en SaaS.

---

## 🐛 Bug corregido: `/reservar` vacío al entrar por IP de red (celular)

**Síntoma**: por `localhost:3000/reservar` todo funcionaba; por
`http://<IP-de-red>:3000/reservar` (la URL real que usa un celular en la
misma WiFi) el nombre de la barbería aparecía como "BARBERÍA" genérico, el
barbero como "tu barbero" y la lista de servicios quedaba vacía, sin ningún
error visible.

**Causa raíz**: no era el backend — el servidor responde **byte a byte
idéntico** sin importar el host usado (headers, JSON y HTML verificados con
`curl` contra ambos orígenes). El origen del bug era el **Service Worker**
(`public/sw.js`), que en producción se registra por separado para cada
origen (`localhost:3000` y `192.168.1.7:3000` son orígenes distintos con
Cache Storage independiente). Su `fetch` handler aplicaba una estrategia
"cache-first" a **cualquier** petición GET que no fuera una navegación —
incluidas `/api/public/config` y `/api/public/services` — sin excluir
explícitamente las rutas `/api/*`. Si ese origen (el de la IP, probado en
una sesión de pruebas anterior con `npm start`) tenía alguna respuesta
cacheada previa de esas rutas, la servía en vez de ir a la red, y el cliente
nunca se enteraba porque la promesa igual resolvía "bien" (solo con datos
viejos/vacíos), sin lanzar el `catch` que muestra el error.

**Corrección** (`public/sw.js`, ahora `barberia-v2`):
- Las rutas `/api/*` ahora se ignoran por completo en el `fetch` handler
  (`return` sin `event.respondWith`) — el navegador las maneja de forma
  nativa, nunca pasan por Cache Storage en ninguna dirección.
- El cache-first solo aplica a `/_next/static/` y `/images/` (assets
  realmente estáticos), no a "todo lo que no sea navegación" como antes.
- El fallback de navegación offline ahora cachea/lee por la URL real de la
  petición, no bajo una clave `"/"` compartida por todas las páginas.
- Se subió la versión del caché (`barberia-v1` → `barberia-v2`), lo que
  fuerza al `activate` handler a purgar cualquier caché vieja en los
  navegadores/celulares que ya hubieran visitado el sitio antes de este fix.
- Defensa adicional: los `fetch()` del lado del cliente hacia `/api/public/*`
  en `/reservar` y `/cita/[code]` ahora usan `{ cache: "no-store" }`, así el
  caché HTTP normal del navegador tampoco puede servir una respuesta vieja,
  independientemente del Service Worker.
- Prueba de regresión: `tests/service-worker.test.ts` carga `public/sw.js`
  real contra un `ServiceWorkerGlobalScope` simulado y verifica que las
  peticiones a `/api/*` nunca consultan `caches.match(...)`.

`/` no se vio afectada (se renderiza en el servidor con `force-dynamic`, sin
fetch del lado del cliente). `/admin/*` tampoco (usa Server Actions, que son
POST, y el Service Worker ya ignoraba los métodos distintos de GET).

## 🐛 Bug corregido: scroll horizontal en todo `/admin` en móvil

Detectado con una auditoría visual real en viewport móvil (390px, ver
`scripts/mobile-audit.mjs`): **todas** las páginas de `/admin` tenían scroll
horizontal (el documento medía 895px de ancho sobre un viewport de 390px).

**Causa raíz**: en `src/app/admin/layout.tsx`, el contenedor de contenido
(`<div className="flex-1 md:pl-60">`, hermano flex del `<aside>` de escritorio)
es un ítem `flex-1` dentro de un `flex` sin `flex-wrap`. Por defecto, un ítem
flex tiene `min-width: auto`, es decir, **nunca se encoge por debajo del
ancho intrínseco de su contenido** aunque tenga `flex: 1`. El contenido (el
menú de chips con scroll horizontal propio, `overflow-x-auto`, del header
móvil) quiere ~900px de ancho, así que el contenedor entero se estiraba a
900px en vez de quedarse en los 390px del viewport — el menú de chips
funcionaba, pero arrastraba toda la página con él.

**Corrección**: se agregó `min-w-0` a ese contenedor
(`className="min-w-0 flex-1 md:pl-60"`), el arreglo estándar de Tailwind/
Flexbox para este caso — así el ítem sí se encoge al ancho disponible y el
menú de chips vuelve a hacer scroll **dentro** de la pantalla, no la pantalla
entera.

**Verificación**: `scripts/mobile-audit.mjs` (Playwright headless, viewport
iPhone 13) recorre `/`, `/reservar` completo, `/cita/buscar`, `/cita/[code]`
y las 11 subpáginas de `/admin` en modo claro y oscuro, midiendo
`document.documentElement.scrollWidth` vs `clientWidth` y capturando errores
de consola. Antes del fix: 11/11 páginas de admin con scroll horizontal.
Después: 0/18 páginas con scroll horizontal, 0 errores de consola. Para
volver a correrlo (requiere `npm run dev` activo en otra terminal):

```bash
npx playwright install chromium   # una sola vez
node scripts/mobile-audit.mjs     # capturas en tu carpeta temporal / revisa la consola
```

---

## 🚀 Inicio rápido

### Requisitos
- Node.js 20+
- PostgreSQL 14+ (local o en la nube)

### 1. Instalar y configurar

```bash
npm install
cp .env.example .env
# edita DATABASE_URL con tu conexión a PostgreSQL
```

### 2. Crear el esquema y datos de demostración

```bash
npx drizzle-kit push          # crea las tablas
npx tsx src/db/seed.ts        # barbero, servicios, clientes y citas de prueba
```

> Credenciales del panel: **admin@barberia.com / admin123** (cámbiala desde Configuración → Cambiar contraseña).

### 3. Ejecutar

```bash
npm run dev        # desarrollo → http://localhost:3000
npm run typecheck  # verificación de tipos
npm run test       # suite de pruebas (vitest, usa la misma DATABASE_URL)
npm run build      # producción
npm start
```

---

## 🗺️ Rutas

| Ruta | Descripción |
|---|---|
| `/` | Landing pública: servicios, horarios, ubicación, WhatsApp, QR |
| `/reservar` | Flujo de reserva en 5 pasos (sin cuenta) |
| `/cita/[codigo]` | Consultar, cancelar o reprogramar una reserva |
| `/cita/buscar` | Buscar reserva por código o teléfono |
| `/login` | Acceso al panel del barbero |
| `/admin` | Dashboard (resumen del día) |
| `/admin/calendar` | Calendario día / semana / mes |
| `/admin/appointments` | Citas: crear, editar estado, cancelar |
| `/admin/clients` | Clientes e historial |
| `/admin/services` | Servicios, precios y duración |
| `/admin/schedule` | Horarios de trabajo y descansos |
| `/admin/blocks` | Bloqueos de fechas/horarios |
| `/admin/income` | Control de ingresos y métodos de pago |
| `/admin/stats` | Estadísticas y gráficos |
| `/admin/notifications` | Notificaciones internas |
| `/admin/settings` | Configuración general, QR, contraseña |

---

## 🔌 API pública

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/public/config` | Info de la barbería y reglas de reserva |
| GET | `/api/public/services` | Servicios activos |
| GET | `/api/public/availability?date=YYYY-MM-DD&duration=30` | Horarios disponibles de un día |
| GET | `/api/public/availability?range=30&duration=30` | Resumen de disponibilidad de los próximos 30 días |
| POST | `/api/public/bookings` | Crear reserva (validación real en backend) |
| GET | `/api/public/bookings?phone=...` | Buscar reservas por teléfono |
| GET | `/api/public/bookings/[code]` | Consultar reserva |
| PATCH | `/api/public/bookings/[code]` | Reprogramar reserva `{date, startMin}` |
| DELETE | `/api/public/bookings/[code]` | Cancelar reserva |
| POST | `/api/auth` | Login del panel |
| DELETE | `/api/auth` | Logout |

---

## 🧠 Cálculo de disponibilidad

El motor (`src/lib/availability.ts`) calcula los horarios en tiempo real considerando:

- Horario laboral por día (múltiples bloques, ej. 08:00–12:00 / 14:00–18:00)
- Descansos recurrentes
- Bloqueos de fecha (días completos o rangos)
- Citas existentes (incluye el tiempo de separación `gap_min`)
- Duración del servicio seleccionado (recalcula al cambiar de servicio)
- Anticipación mínima (ej. 30 min) y máxima (ej. 30 días)
- Zona horaria configurada (por defecto `America/Bogota`)

Los horarios se guardan como **timestamps UTC** y se convierten a la zona horaria configurada en la base de datos — nunca se depende de la hora del navegador para la lógica.

## 🛡️ Prevención de doble reserva

1. **Frontend**: los horarios ocupados se muestran deshabilitados.
2. **API**: la disponibilidad se valida de nuevo en el servidor en cada petición.
3. **Base de datos**: la creación se ejecuta en una **transacción** con un **bloqueo de asesoría de PostgreSQL** (`pg_advisory_xact_lock`) por barbero y día. Dos clientes que intentan reservar la misma hora al mismo tiempo: el segundo recibe un error `409` y el horario nunca queda duplicado.

## 🔐 Seguridad

- Contraseñas con **bcrypt** (hash + sal).
- Sesiones con token aleatorio en cookie `httpOnly` (tabla `sessions`, expiración 7 días).
- Rutas `/admin/*` protegidas en el layout del servidor.
- Rate limiting en `/api/public/bookings` y `/api/auth`.
- Validación y sanitización de entradas en frontend y backend.
- Consultas parametrizadas (Drizzle) → protección contra SQL injection.
- React escapa el contenido → protección contra XSS.
- Credenciales solo en variables de entorno (`.env`).

## 💾 Backups

```bash
# Respaldo completo
pg_dump postgresql://usuario:pass@host:5432/app_db > backup_$(date +%F).sql

# Restaurar
psql postgresql://usuario:pass@host:5432/app_db < backup_2026-08-01.sql

# Frecuencia recomendada: diario (cron) + verificación semanal.
```

Se respaldan todas las tablas (users, barbers, services, clients, appointments, business_hours, breaks, blocked_slots, notifications, payments, settings, audit_logs).

## 👤 Crear el primer administrador (sin seed)

Para una base de datos de producción nueva, sin datos ficticios: crea
exactamente un usuario admin y un barbero (sin servicios, horarios ni
clientes de ejemplo — eso se configura después desde `/admin`):

```bash
npx tsx scripts/bootstrap-first-admin.ts "Tu Nombre" "tu@correo.com" "tu-clave-segura" "Nombre del Barbero"
```

Es seguro volver a correrlo: si el correo o el slug del barbero ya existen,
no duplica nada.

## 🏗️ Arquitectura

```
src/
├─ app/
│  ├─ api/            # API pública (config, services, availability, bookings, auth)
│  ├─ admin/          # Panel del barbero (layout protegido + páginas)
│  ├─ reservar/       # Wizard de reserva
│  ├─ cita/[code]/    # Gestión de cita (cancelar/reprogramar)
│  ├─ login/          # Login del panel
│  ├─ layout.tsx      # Layout raíz (SEO, OG, PWA)
│  └─ manifest.ts     # PWA manifest
├─ components/        # Providers (tema oscuro/claro, service worker)
├─ db/                # schema.ts (tablas) · index.ts (cliente) · seed.ts
└─ lib/
   ├─ availability.ts # Motor de disponibilidad + transacción anti doble-reserva
   ├─ auth.ts         # Hash, sesiones, guard
   ├─ settings.ts     # Configuración por barbero
   ├─ actions.ts      # Server Actions del panel
   └─ utils.ts        # Zona horaria, moneda, notificaciones, auditoría
```

### Base de datos (entidades)

`users` · `sessions` · `barbers` · `services` · `clients` · `appointments` · `business_hours` · `breaks` · `blocked_slots` · `notifications` · `payments` · `settings` · `audit_logs`

Todas las entidades de negocio llevan `barber_id`, y `appointments` guarda una foto del servicio (`service_name`, `price`, `duration_min`) para conservar el historial aunque se edite el servicio.

## 🔮 Preparado para el futuro

- **Multibarbero**: `/reservar?barber=slug` y tabla `barbers` con slug único. El motor de disponibilidad ya opera por `barber_id`.
- **SaaS**: agregar `business_id` a `barbers` agrupa barberías sin rehacer tablas.
- **WhatsApp/Telegram/Email**: las notificaciones internas ya se generan en `notifications`; el sistema está listo para conectar proveedores oficiales (no se incluye una integración falsa).
- **Recordatorios**: activables en Configuración; listos para enviarse 24h / 2h antes vía proveedor.
- **PWA**: manifest + service worker (`public/sw.js`) instalable en Android/iPhone/Windows.

## 🧪 Pruebas automatizadas

```bash
npm run test        # vitest — corre toda la suite contra una base de datos real
```

Las pruebas usan un barbero aislado (`test-barber-vitest`, creado y eliminado en cada corrida vía `tests/helpers.ts`) para no tocar los datos del seed. Cubren:

- **Doble reserva simultánea**: dos peticiones concurrentes al mismo horario → exactamente una `200` y una `409`/`ok:false`, y una sola fila en `appointments`.
- Reservas que se cruzan parcialmente con una cita existente → rechazadas.
- Disponibilidad recalculada al cambiar la duración del servicio (30 min vs 60 min).
- Fecha pasada, fuera de horario laboral, fuera del rango de anticipación máxima, durante un descanso y durante un bloqueo → todas rechazadas.
- Cancelación: libera el horario y respeta la ventana mínima de cancelación (`cancel_window_min`).
- Reprogramación: libera el horario anterior y ocupa el nuevo de forma atómica.
- Autenticación: `getCurrentUser()` retorna `null` sin cookie de sesión o con un token expirado (la base del guard que protege `/admin/*`).

> ⚠️ Las reservas nuevas requieren conexión a Internet (garantiza disponibilidad real). El panel puede reutilizar información ya cargada offline.

## 🖼️ Imágenes

`public/images/hero.jpg`, `barber.jpg`, `icon-192.png` e `icon-512.png` son **placeholders generados** (gradiente oscuro + ícono de tijeras en la paleta de marca), no fotos reales de la barbería. Reemplázalos antes de producción:

- `hero.jpg` (1600×900+): foto del local o del corte, usada en el hero de `/` y como imagen de Open Graph al compartir por WhatsApp.
- `barber.jpg` (retrato): foto del barbero, usada en `/` y como valor por defecto de `barbers.photo`.
- `icon-192.png` / `icon-512.png` (cuadradas): ícono de la app para el manifest PWA y el favicon.

Puedes regenerar los placeholders con `node scripts/gen-placeholder-images.mjs` si necesitas ajustarlos mientras consigues fotos reales.
