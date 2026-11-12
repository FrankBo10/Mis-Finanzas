// Piezas de interfaz reutilizables: paneles ("sheets"), formularios, avisos.
import { h, $, parseAmount, centsToInput } from './util.js';

export function closeAllSheets() {
  $('#sheets').replaceChildren();
}

// Panel a pantalla completa con cabecera. Devuelve { el, close }.
export function openSheet({ title, body, onSave, saveLabel = 'Guardar', cancelLabel = 'Cancelar' }) {
  const close = () => el.remove();
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'link', onclick: close }, cancelLabel),
      h('h2', null, title),
      onSave ? h('button', { type: 'button', class: 'link strong', onclick: () => onSave(close) }, saveLabel) : h('span', { class: 'link' }, '')
    ),
    h('div', { class: 'sheet-body' }, body)
  );
  $('#sheets').append(el);
  return { el, close };
}

/* Formulario genérico.
   fields: [{ key, label, type, options, required, showIf, positive, allowNegative, placeholder, hint }]
   type: 'text' | 'password' | 'money' | 'number' | 'date' | 'color' | 'select' | 'seg'
   - options: [[valor, texto], ...] o una función (valores) => opciones
   - showIf: (valores) => true/false para mostrar u ocultar el campo */
export function openForm({ title, intro, fields, values = {}, onSave, onDelete, deleteLabel = 'Eliminar', validate, extraButtons = [] }) {
  const vals = { ...values };
  const ctl = [];
  const err = h('p', { class: 'form-error', hidden: true, role: 'alert' });

  const refresh = () => {
    for (const c of ctl) {
      const f = c.f;
      c.row.hidden = f.showIf ? !f.showIf(vals) : false;
      if (f.type === 'select') {
        const opts = typeof f.options === 'function' ? f.options(vals) : f.options;
        const sig = JSON.stringify(opts);
        if (sig !== c.sig) {
          c.sig = sig;
          c.input.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)));
        }
        if (!opts.some(([v]) => v === vals[f.key])) vals[f.key] = opts.length ? opts[0][0] : '';
        c.input.value = vals[f.key];
      } else if (f.type === 'seg') {
        for (const b of c.input.children) b.classList.toggle('on', b.dataset.v === vals[f.key]);
      }
    }
  };

  const body = h('div', { class: 'form-body' }, intro && h('p', { class: 'form-intro' }, intro));
  for (const f of fields) {
    let input;
    if (f.type === 'select') {
      input = h('select', { onchange: () => { vals[f.key] = input.value; refresh(); } });
    } else if (f.type === 'seg') {
      input = h('div', { class: 'seg' }, f.options.map(([v, l]) =>
        h('button', { type: 'button', 'data-v': v, onclick: () => { vals[f.key] = v; refresh(); } }, l)));
    } else {
      const money = f.type === 'money';
      input = h('input', {
        type: money ? 'text' : f.type || 'text',
        inputmode: money ? 'decimal' : f.type === 'number' ? 'numeric' : null,
        placeholder: f.placeholder || (money ? '0,00' : null),
        autocomplete: f.autocomplete || 'off',
        maxlength: !f.type || f.type === 'text' ? f.maxlength || 120 : null,
        class: money ? 'money-input' : null,
      });
      const v = vals[f.key];
            input.value = money ? (v ? centsToInput(v) : '') : v ?? '';
      if (money) input.addEventListener('focus', () => setTimeout(() => { try { input.setSelectionRange(0, input.value.length); } catch { /* sin selección */ } }, 0));
    }
    const row = h(f.type === 'seg' ? 'div' : 'label', { class: 'field' },
      h('span', { class: 'field-label' }, f.label), input, f.hint && h('span', { class: 'field-hint' }, f.hint));
    ctl.push({ f, row, input });
    body.append(row);
  }
  body.append(err);

  const fail = (msg) => { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); };

  const collect = () => {
    const out = {};
    for (const c of ctl) {
      const f = c.f;
      if (c.row.hidden) { out[f.key] = null; continue; }
      if (f.type === 'select' || f.type === 'seg') { out[f.key] = vals[f.key] === '' || vals[f.key] == null ? null : vals[f.key]; continue; }
      const raw = f.type === 'password' ? c.input.value : c.input.value.trim();
      if (raw === '') {
        if (f.required) throw new Error(`Falta rellenar: ${f.label}`);
        out[f.key] = f.type === 'text' || !f.type ? '' : null;
        continue;
      }
      if (f.type === 'money') {
        const cents = parseAmount(raw);
        if (cents == null) throw new Error(`"${f.label}" no es un importe válido. Ejemplo: 12,50`);
        if (cents < 0 && !f.allowNegative) throw new Error(`"${f.label}" no puede ser negativo`);
        if (f.positive && cents <= 0) throw new Error(`"${f.label}" debe ser mayor que cero`);
        out[f.key] = cents;
      } else if (f.type === 'number') {
        const n = parseInt(raw, 10);
        if (!Number.isInteger(n) || n < 1 || n > 999) throw new Error(`"${f.label}" debe ser un número entre 1 y 999`);
        out[f.key] = n;
      } else out[f.key] = raw;
    }
    return out;
  };

  let busy = false;
  const save = async (close) => {
    if (busy) return;
    err.hidden = true;
    let out;
    try { out = collect(); } catch (e) { return fail(e.message); }
    const msg = validate && validate(out);
    if (msg) return fail(msg);
    busy = true;
    try {
      const res = await onSave(out);
      if (typeof res === 'string') return fail(res); // onSave puede devolver un mensaje de error
      close();
    } catch (e) {
      fail(e.message || 'Ha ocurrido un error');
    } finally { busy = false; }
  };

  const sheet = openSheet({ title, body, onSave: save });
  if (onDelete || extraButtons.length) {
    body.append(h('div', { class: 'form-actions' },
      extraButtons.map((b) => h('button', { type: 'button', class: 'btn', onclick: () => b.onClick(sheet.close) }, b.label)),
      onDelete && h('button', { type: 'button', class: 'btn danger', onclick: () => onDelete(sheet.close) }, deleteLabel)));
  }
  refresh();
  const first = ctl.find((c) => c.f.autofocus);
  if (first) setTimeout(() => first.input.focus(), 50);
  return sheet;
}

let toastTimer;
export function toast(msg, { action, onAction, ms = 4000 } = {}) {
  const box = $('#toast');
  clearTimeout(toastTimer);
  box.replaceChildren(h('span', null, msg));
  if (action) box.append(h('button', { type: 'button', onclick: () => { box.hidden = true; onAction(); } }, action));
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, action ? 7000 : ms);
}

// Pregunta de confirmación. Devuelve una promesa con true/false.
export function confirmDialog(message, { ok = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { el.remove(); resolve(v); };
    const el = h('div', { class: 'modal-wrap', role: 'alertdialog', 'aria-modal': 'true' },
      h('div', { class: 'modal' },
        h('p', null, message),
        h('div', { class: 'modal-btns' },
          h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, 'Cancelar'),
          h('button', { type: 'button', class: 'btn ' + (danger ? 'danger solid' : 'primary'), onclick: () => done(true) }, ok))));
    $('#sheets').append(el);
  });
}
