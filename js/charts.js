// Gráficos dibujados a mano con SVG (sin librerías externas).
import { svg, monthLabel } from './util.js';

// Gráfico de rosquilla. items = [{color, value}]
export function donut(items, centerTop, centerBottom) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const root = svg('svg', { viewBox: '0 0 42 42', class: 'donut', role: 'img', 'aria-label': 'Reparto por categorías' });
  root.append(svg('circle', { cx: 21, cy: 21, r: 15.915, fill: 'none', class: 'donut-bg', 'stroke-width': 5 }));
  let acc = 0;
  for (const it of items) {
    const pct = total ? (it.value / total) * 100 : 0;
    if (pct <= 0) continue;
    root.append(svg('circle', {
      cx: 21, cy: 21, r: 15.915, fill: 'none', stroke: it.color, 'stroke-width': 5,
      'stroke-dasharray': `${pct} ${100 - pct}`, 'stroke-dashoffset': 25 - acc,
    }));
    acc += pct;
  }
  root.append(svg('text', { x: 21, y: 20, 'text-anchor': 'middle', class: 'donut-top' }, centerTop));
  root.append(svg('text', { x: 21, y: 25, 'text-anchor': 'middle', class: 'donut-bottom' }, centerBottom));
  return root;
}

// Barras de ingresos y gastos por mes. data = [{ym, income, expense}]
export function bars(data) {
  const W = 320, H = 150, base = 122, top = 8;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Ingresos y gastos por mes' });
  root.append(svg('line', { x1: 0, x2: W, y1: base, y2: base, class: 'axis' }));
  const slot = W / data.length;
  data.forEach((d, i) => {
    const x = i * slot + slot / 2;
    const bw = Math.min(16, slot / 3);
    const hi = ((base - top) * d.income) / max, he = ((base - top) * d.expense) / max;
    root.append(svg('rect', { x: x - bw - 1, y: base - hi, width: bw, height: hi, rx: 2, class: 'bar-income' }));
    root.append(svg('rect', { x: x + 1, y: base - he, width: bw, height: he, rx: 2, class: 'bar-expense' }));
    root.append(svg('text', { x, y: H - 10, 'text-anchor': 'middle', class: 'chart-label' }, monthLabel(d.ym, true)));
  });
  return root;
}

// Línea de evolución. data = [{ym, value}]
export function line(data) {
  const W = 320, H = 150, top = 10, bottom = 122;
  const vals = data.map((d) => d.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Evolución del patrimonio' });
  const step = (W - 20) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [10 + i * step, bottom - ((d.value - min) / (max - min)) * (bottom - top)]);
  const path = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  root.append(svg('polygon', { points: `10,${bottom} ${path} ${W - 10},${bottom}`, class: 'line-area' }));
  root.append(svg('polyline', { points: path, class: 'line-stroke', fill: 'none' }));
  if (min < 0 && max > 0) {
    const y0 = bottom - ((0 - min) / (max - min)) * (bottom - top);
    root.append(svg('line', { x1: 10, x2: W - 10, y1: y0, y2: y0, class: 'axis dashed' }));
  }
  data.forEach((d, i) => {
    if (data.length > 7 && i % 2 !== (data.length - 1) % 2) return;
    root.append(svg('text', { x: pts[i][0], y: H - 10, 'text-anchor': 'middle', class: 'chart-label' }, monthLabel(d.ym, true)));
  });
  return root;
}
