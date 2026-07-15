import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { AddressInfo } from 'net'
import { mkdirSync } from 'fs'
import { join } from 'path'
import Datastore from '@seald-io/nedb'


interface PriceItem {
  code: string
  name: string
  duration: string
  price: number
  currency: string
}
interface DepartmentOption {
  id: string
  name: string
  doctors: string[]
  room: string
}
interface BookingDoc {
  bookingId: string
  createdAt: number
  patient_name: string
  patient_phone: string
  hkid: string
  appointment_time: string
  department_or_doctor: string
  department: DepartmentOption | null
  item_code: string
  priceItem: PriceItem | null
}

const PRICING_LIST: PriceItem[] = [
  { code: 'CT26', name: 'CT Lung Screen', duration: '20 min', price: 380, currency: 'HKD' },
  { code: 'CT29', name: 'CT Thorax', duration: '20 min', price: 420, currency: 'HKD' },
  { code: 'CT23', name: 'CT HRCT Thorax', duration: '20 min', price: 460, currency: 'HKD' },
  { code: 'CT18', name: 'CT Pulmonary Angiogram (Contrast)', duration: '20 min', price: 720, currency: 'HKD' },
  { code: 'CT30', name: 'CT Thorax + Abdomen + Pelvis (TAP)', duration: '20 min', price: 1280, currency: 'HKD' },
  { code: 'XR11', name: 'X-Ray Chest - 1 view (filmless)', duration: '15 min', price: 60, currency: 'HKD' },
  { code: 'XR13', name: 'X-Ray Chest - 2 views', duration: '15 min', price: 95, currency: 'HKD' },
  { code: 'MR01', name: 'MRI Brain', duration: '30 min', price: 980, currency: 'HKD' },
  { code: 'US05', name: 'Ultrasound Abdomen (incl. Kidneys)', duration: '20 min', price: 220, currency: 'HKD' },
  { code: 'MMG01', name: 'Mammogram', duration: '20 min', price: 180, currency: 'HKD' }
]

const DEPARTMENTS: DepartmentOption[] = [
  { id: 'cardiology', name: 'Cardiology', doctors: ['Dr. Sari Lim', 'Dr. Wong Kai'], room: '3F-Cardio' },
  { id: 'radiology', name: 'Radiology', doctors: ['Dr. Nadia Putri', 'Dr. Raymond Lee'], room: '2F-Imaging' },
  { id: 'orthopedics', name: 'Orthopedics', doctors: ['Dr. Daniel Tan'], room: '5F-Ortho' },
  { id: 'general-medicine', name: 'General Medicine', doctors: ['Dr. Maya Chan', 'Dr. Budi Hartono'], room: '1F-General' },
  { id: 'pediatrics', name: 'Pediatrics', doctors: ['Dr. Lily Ho'], room: '4F-Peds' }
]

function resolvePriceItem(code: string): PriceItem | null {
  return PRICING_LIST.find((item) => item.code === code) || null
}

function resolveDepartment(value: string): DepartmentOption | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  return (
    DEPARTMENTS.find((department) => {
      if (department.id.toLowerCase() === normalized) return true
      if (department.name.toLowerCase() === normalized) return true
      return department.doctors.some((doctor) => doctor.toLowerCase() === normalized)
    }) || null
  )
}

// Two fictional sample rows so the list is never empty on first launch. Inserted
// only when the collection is empty (see ensureDb). createdAt is fixed in the past
// so freshly booked rows always sort above the seeds.
function seedBookings(): BookingDoc[] {
  const base = Date.parse('2026-06-01T00:00:00Z')
  return [
    {
      bookingId: 'demo-seed-1',
      createdAt: base,
      patient_name: 'Ada Chen',
      patient_phone: '+852 9123 4567',
      hkid: 'A123456(7)',
      appointment_time: '2026-06-09T09:30',
      department_or_doctor: 'cardiology',
      department: resolveDepartment('cardiology'),
      item_code: 'CT26',
      priceItem: resolvePriceItem('CT26')
    },
    {
      bookingId: 'demo-seed-2',
      createdAt: base + 3600_000,
      patient_name: 'Chan Tai Man',
      patient_phone: '+852 9888 2211',
      hkid: 'B987654(3)',
      appointment_time: '2026-06-10T14:00',
      department_or_doctor: 'radiology',
      department: resolveDepartment('radiology'),
      item_code: 'XR13',
      priceItem: resolvePriceItem('XR13')
    }
  ]
}

function buildBookingDoc(payload: Record<string, unknown>): BookingDoc {
  const get = (key: string): string => (typeof payload[key] === 'string' ? (payload[key] as string) : '')
  const item_code = get('item_code') || 'CT26'
  const department_or_doctor = get('department_or_doctor') || get('department_id') || 'cardiology'
  return {
    bookingId: `demo-${Date.now()}`,
    createdAt: Date.now(),
    patient_name: get('patient_name'),
    patient_phone: get('patient_phone'),
    hkid: get('hkid'),
    appointment_time: get('appointment_time'),
    department_or_doctor,
    department: resolveDepartment(department_or_doctor),
    item_code,
    priceItem: resolvePriceItem(item_code)
  }
}

export class BookingDemoService {
  private server: Server | null = null
  private url: string | null = null
  private db: Datastore<BookingDoc> | null = null

  constructor(private readonly dataDir: string) {}

  async start(): Promise<string> {
    if (this.url) return this.url
    await this.ensureDb()
    this.server = createServer(async (req, res) => {
      const path = new URL(req.url || '/', 'http://127.0.0.1').pathname
      if (req.method === 'GET' && (path === '/' || path === '/booking')) {
        send(res, 200, 'text/html; charset=utf-8', bookingHtml())
        return
      }
      if (req.method === 'GET' && path === '/api/pricing-list') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, items: PRICING_LIST }))
        return
      }
      if (req.method === 'GET' && path === '/api/departments') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, departments: DEPARTMENTS }))
        return
      }
      if (req.method === 'GET' && path === '/api/bookings') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, bookings: await this.listBookings() }))
        return
      }
      if (req.method === 'POST' && path === '/api/bookings') {
        const payload = safeJson(await readBody(req))
        const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
        const stored = await this.insertBooking(buildBookingDoc(record))
        send(
          res,
          200,
          'application/json; charset=utf-8',
          JSON.stringify({
            ok: true,
            bookingId: stored.bookingId,
            received: payload,
            department: stored.department,
            priceItem: stored.priceItem,
            createdAt: stored.createdAt,
            booking: stored
          })
        )
        return
      }
      if (req.method === 'DELETE' && path.startsWith('/api/bookings/')) {
        const bookingId = decodeURIComponent(path.slice('/api/bookings/'.length))
        const removed = await this.removeBooking(bookingId)
        if (!removed) {
          send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: 'booking not found' }))
          return
        }
        send(
          res,
          200,
          'application/json; charset=utf-8',
          JSON.stringify({ ok: true, deleted: true, bookingId, booking: removed })
        )
        return
      }
      send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: 'not found' }))
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    const address = this.server.address() as AddressInfo
    this.url = `http://127.0.0.1:${address.port}/booking`
    return this.url
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.url = null
  }

  private async ensureDb(): Promise<Datastore<BookingDoc>> {
    if (this.db) return this.db
    const dir = join(this.dataDir, 'coach-demo')
    mkdirSync(dir, { recursive: true })
    const db = new Datastore<BookingDoc>({ filename: join(dir, 'bookings.db'), autoload: true })
    await db.loadDatabaseAsync()
    if ((await db.countAsync({})) === 0) await db.insertAsync(seedBookings())
    this.db = db
    return db
  }

  private async listBookings(): Promise<BookingDoc[]> {
    const db = await this.ensureDb()
    const docs = await db.findAsync<BookingDoc>({})
    return [...docs].sort((a, b) => b.createdAt - a.createdAt)
  }

  private async insertBooking(doc: BookingDoc): Promise<BookingDoc> {
    const db = await this.ensureDb()
    return db.insertAsync(doc)
  }

  private async removeBooking(bookingId: string): Promise<BookingDoc | null> {
    if (!bookingId) return null
    const db = await this.ensureDb()
    const doc = await db.findOneAsync<BookingDoc>({ bookingId })
    if (!doc) return null
    await db.removeAsync({ bookingId }, { multi: false })
    return doc
  }
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store'
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
  })
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

function bookingHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Coach Booking Demo</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef2f5; color: #18212f; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 860px; margin: 0 auto; padding: 24px 16px 0; }
      header h1 { margin: 0; font-size: 22px; }
      .actions { display: flex; gap: 8px; }
      main { max-width: 860px; margin: 16px auto 48px; padding: 0 16px; }
      button { height: 38px; padding: 0 16px; border: 0; border-radius: 6px; font: inherit; font-weight: 700; cursor: pointer; }
      .btn-primary { background: #0f766e; color: #fff; }
      .btn-ghost { background: #fff; color: #0f766e; border: 1px solid #cbd4df; }
      .btn-danger { background: #b91c1c; color: #fff; }
      .list { display: flex; flex-direction: column; gap: 10px; }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fff; border: 1px solid #d7dde5; border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: border-color .12s, box-shadow .12s; }
      .row:hover { border-color: #0f766e; box-shadow: 0 1px 6px rgba(15,118,110,.12); }
      .row .who { font-weight: 700; font-size: 15px; }
      .row .meta { color: #5b6b7e; margin-top: 3px; }
      .row .pill { flex: 0 0 auto; background: #e6f4f1; color: #0f766e; border-radius: 999px; padding: 4px 10px; font-weight: 700; font-size: 12px; }
      .empty { background: #fff; border: 1px dashed #cbd4df; border-radius: 8px; padding: 28px; text-align: center; color: #5b6b7e; }
      h2 { font-size: 14px; color: #455468; margin: 26px 0 8px; }
      pre#result { min-height: 42px; padding: 12px; background: #f6f8fa; border: 1px solid #e2e8ef; border-radius: 6px; white-space: pre-wrap; word-break: break-word; margin: 0; }
      label { display: block; margin: 14px 0 6px; color: #455468; font-weight: 600; }
      input, select { width: 100%; height: 38px; border: 1px solid #cbd4df; border-radius: 6px; padding: 0 10px; font: inherit; }
      .backdrop { position: fixed; inset: 0; background: rgba(15,21,31,.32); opacity: 0; pointer-events: none; transition: opacity .18s; z-index: 10; }
      .backdrop.show { opacity: 1; pointer-events: auto; }
      .drawer { position: fixed; top: 0; right: 0; height: 100%; width: 420px; max-width: 92vw; background: #fff; box-shadow: -8px 0 24px rgba(15,21,31,.18); transform: translateX(100%); transition: transform .22s ease; z-index: 20; display: flex; flex-direction: column; }
      .drawer.open { transform: translateX(0); }
      .drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid #e2e8ef; }
      .drawer-head h2 { margin: 0; font-size: 17px; color: #18212f; }
      .drawer-body { padding: 16px 20px 24px; overflow: auto; }
      .close { background: transparent; color: #5b6b7e; font-size: 20px; padding: 0 6px; height: 32px; }
      .kv { display: flex; justify-content: space-between; gap: 16px; padding: 9px 0; border-bottom: 1px solid #eef2f5; }
      .kv .k { color: #5b6b7e; }
      .kv .v { font-weight: 600; text-align: right; }
    </style>
  </head>
  <body>
    <header>
      <h1>Patient Bookings</h1>
      <div class="actions">
        <button id="refresh-list" class="btn-ghost" type="button">Refresh</button>
        <button id="new-booking" class="btn-primary" type="button">New Booking</button>
      </div>
    </header>
    <main>
      <div id="booking-list" class="list"></div>
      <!-- The visible response panel is removed; #result stays hidden as a
           machine-readable sink the API replay path can still write into. -->
      <pre id="result" hidden></pre>
    </main>

    <div id="backdrop" class="backdrop"></div>

    <aside id="detail-drawer" class="drawer" aria-label="Booking detail">
      <div class="drawer-head">
        <h2>Booking detail</h2>
        <button id="close-detail" class="close" type="button" aria-label="Close">&times;</button>
      </div>
      <div id="detail-body" class="drawer-body"></div>
    </aside>

    <!-- The "New booking" drawer + form are NOT in the static markup. They are
         mounted into the DOM only when "New Booking" is clicked (buildNewBookingDrawer)
         and removed again on close — so an automation agent must click New Booking
         before the form fields exist to observe and fill. -->

    <script>
      const state = { bookings: [] };
      let pricingLoaded = false;
      let departmentsLoaded = false;

      const $ = (id) => document.getElementById(id);
      const showError = (err) => { console.error('[demo]', err); };
      const fmtTime = (ms) => { try { return new Date(ms).toLocaleString(); } catch (e) { return String(ms); } };
      const ensureDemoAuth = () => {
        if (!localStorage.getItem('access_token')) localStorage.setItem('access_token', 'demo-local-token-2026');
      };
      const demoFetch = (url, options = {}) => {
        ensureDemoAuth();
        const headers = new Headers(options.headers || {});
        const token = localStorage.getItem('access_token');
        if (token && !headers.has('authorization')) headers.set('authorization', 'Bearer ' + token);
        return fetch(url, { ...options, headers });
      };

      async function loadPricingList() {
        if (pricingLoaded) return;
        const res = await demoFetch('/api/pricing-list');
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'pricing list failed');
        const select = $('item-code');
        select.textContent = '';
        for (const item of data.items) {
          const option = document.createElement('option');
          option.value = item.code;
          option.textContent = item.code + ' · ' + item.name + ' · ' + item.currency + ' ' + item.price;
          select.appendChild(option);
        }
        select.value = 'CT26';
        pricingLoaded = true;
      }
      async function loadDepartments() {
        if (departmentsLoaded) return;
        const res = await demoFetch('/api/departments');
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'departments failed');
        const select = $('department-or-doctor');
        select.textContent = '';
        for (const department of data.departments || []) {
          const option = document.createElement('option');
          option.value = department.id;
          option.textContent = department.name + ' · ' + department.doctors.join(', ') + ' · ' + department.room;
          select.appendChild(option);
        }
        select.value = 'cardiology';
        departmentsLoaded = true;
      }
      async function loadBookings() {
        const res = await demoFetch('/api/bookings');
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'bookings failed');
        state.bookings = data.bookings || [];
        renderList();
      }

      function renderList() {
        const list = $('booking-list');
        list.textContent = '';
        if (!state.bookings.length) {
          const empty = document.createElement('div');
          empty.className = 'empty';
          empty.textContent = 'No bookings yet. Click "New Booking" to create one.';
          list.appendChild(empty);
          return;
        }
        for (const booking of state.bookings) {
          const row = document.createElement('div');
          row.className = 'row';
          row.setAttribute('data-id', booking.bookingId);
          const left = document.createElement('div');
          const who = document.createElement('div');
          who.className = 'who';
          who.textContent = booking.patient_name || '(no name)';
          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = booking.appointment_time + ' · ' + ((booking.department && booking.department.name) || booking.department_or_doctor || '—') + ' · ' + (booking.hkid || '—');
          left.appendChild(who);
          left.appendChild(meta);
          const pill = document.createElement('div');
          pill.className = 'pill';
          pill.textContent = (booking.priceItem && booking.priceItem.code) || booking.item_code || '—';
          row.appendChild(left);
          row.appendChild(pill);
          row.addEventListener('click', () => openDetail(booking));
          list.appendChild(row);
        }
      }

      function kv(parent, key, value) {
        const wrap = document.createElement('div');
        wrap.className = 'kv';
        const k = document.createElement('div');
        k.className = 'k';
        k.textContent = key;
        const v = document.createElement('div');
        v.className = 'v';
        v.textContent = value == null || value === '' ? '—' : String(value);
        wrap.appendChild(k);
        wrap.appendChild(v);
        parent.appendChild(wrap);
      }

      function openDetail(booking) {
        const body = $('detail-body');
        body.textContent = '';
        kv(body, 'Patient', booking.patient_name);
        kv(body, 'Phone', booking.patient_phone);
        kv(body, 'HKID', booking.hkid);
        kv(body, 'Appointment', booking.appointment_time);
        kv(body, 'Department / doctor', (booking.department && booking.department.name) || booking.department_or_doctor);
        const item = booking.priceItem;
        kv(body, 'Item', item ? item.code + ' · ' + item.name : booking.item_code);
        if (item) kv(body, 'Price', item.currency + ' ' + item.price + ' · ' + item.duration);
        kv(body, 'Booking ID', booking.bookingId);
        kv(body, 'Created', fmtTime(booking.createdAt));
        const del = document.createElement('button');
        del.id = 'delete-booking';
        del.type = 'button';
        del.className = 'btn-danger';
        del.style.cssText = 'margin-top:18px;width:100%;';
        del.textContent = 'Delete Booking';
        del.addEventListener('click', () => deleteBooking(booking.bookingId).catch(showError));
        body.appendChild(del);
        openDrawer('detail-drawer');
      }

      async function deleteBooking(bookingId) {
        const res = await demoFetch('/api/bookings/' + encodeURIComponent(bookingId), { method: 'DELETE' });
        const data = await res.json();
        $('result').textContent = JSON.stringify(data, null, 2);
        if (data.ok) {
          state.bookings = state.bookings.filter((b) => b.bookingId !== bookingId);
          renderList();
          closeDrawers();
        }
      }

      function openDrawer(id) {
        $(id).classList.add('open');
        $('backdrop').classList.add('show');
      }
      function closeDrawers() {
        $('detail-drawer').classList.remove('open');
        $('backdrop').classList.remove('show');
        // Unmount the New booking drawer entirely so its form leaves the DOM.
        const nb = $('new-booking-drawer');
        if (nb) nb.remove();
      }

      // Build + insert the New booking drawer on demand. The form (and all its
      // fields) only exist in the DOM while the drawer is open.
      function buildNewBookingDrawer() {
        const aside = document.createElement('aside');
        aside.id = 'new-booking-drawer';
        aside.className = 'drawer';
        aside.setAttribute('aria-label', 'New booking');
        aside.innerHTML =
          '<div class="drawer-head"><h2>New booking</h2>' +
          '<button id="close-new-booking" class="close" type="button" aria-label="Close">&times;</button></div>' +
          '<div class="drawer-body"><form id="booking-form">' +
          '<label for="patient-name">Patient name</label>' +
          '<input id="patient-name" name="patient_name" autocomplete="off" placeholder="Ada Chen" required />' +
          '<label for="hkid">HKID</label>' +
          '<input id="hkid" name="hkid" autocomplete="off" placeholder="A123456(7)" />' +
          '<label for="patient-phone">Patient phone</label>' +
          '<input id="patient-phone" name="patient_phone" autocomplete="off" placeholder="请输入你的手机号" />' +
          '<label for="appointment-time">Appointment time</label>' +
          '<input id="appointment-time" name="appointment_time" type="datetime-local" required />' +
          '<label for="department-or-doctor">Department or doctor</label>' +
          '<select id="department-or-doctor" name="department_or_doctor"></select>' +
          '<label for="item-code">Requested item</label>' +
          '<select id="item-code" name="item_code"></select>' +
          '<button id="submit-booking" class="btn-primary" type="submit" style="margin-top:18px;width:100%;">Book Appointment</button>' +
          '</form></div>';
        document.body.appendChild(aside);
        aside.querySelector('#close-new-booking').addEventListener('click', closeDrawers);
        aside.querySelector('#department-or-doctor').addEventListener('focus', () => loadDepartments().catch(showError));
        aside.querySelector('#item-code').addEventListener('focus', () => loadPricingList().catch(showError));
        aside.querySelector('#booking-form').addEventListener('submit', onBookingSubmit);
        return aside;
      }

      async function onBookingSubmit(event) {
        event.preventDefault();
        const form = event.currentTarget;
        await loadDepartments();
        await loadPricingList();
        const payload = Object.fromEntries(new FormData(form).entries());
        const res = await demoFetch('/api/bookings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        $('result').textContent = JSON.stringify(data, null, 2);
        if (data.ok && data.booking) {
          state.bookings.unshift(data.booking);
          renderList();
          closeDrawers();
        }
      }

      function openNewBooking() {
        if (!$('new-booking-drawer')) buildNewBookingDrawer();
        // Fields are freshly mounted, so reload the option list each time.
        pricingLoaded = false;
        departmentsLoaded = false;
        loadDepartments().catch(showError);
        loadPricingList().catch(showError);
        const drawer = $('new-booking-drawer');
        requestAnimationFrame(() => {
          drawer.classList.add('open');
          $('backdrop').classList.add('show');
        });
        $('patient-name').focus();
      }

      $('new-booking').addEventListener('click', openNewBooking);
      $('close-detail').addEventListener('click', closeDrawers);
      $('backdrop').addEventListener('click', closeDrawers);
      $('refresh-list').addEventListener('click', () => loadBookings().catch(showError));

      ensureDemoAuth();
      loadBookings().catch(showError);
    </script>
  </body>
</html>`
}
