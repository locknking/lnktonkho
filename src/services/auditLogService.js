import { formatCurrency, formatNumber, cleanNumber, parseSimpleSheetDate, formatDateVN } from '../utils/formatters';

export function formatDateTime(d = new Date()) {
  const pad = (n) => (n < 10 ? '0' + n : n);
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

export function generateLogId() {
  const now = new Date();
  const pad = (n) => (n < 10 ? '0' + n : n);
  const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `LOG_${timeStr}_${randomStr}`;
}

// ─── Định nghĩa cột của sheet NHẬP / XUẤT (dùng chung cho so sánh lịch sử) ───
// kind: 'date' | 'qty' | 'money' | 'text'; scope: 'header' (chung cả đơn) | 'item' (từng dòng SP)
const ORDER_COLUMNS_BASE = [
  { idx: 1, label: 'Ngày', kind: 'date', scope: 'header' },
  { idx: 2, label: 'Trường', kind: 'text', scope: 'header' },
  { idx: 3, label: 'Mã đơn', kind: 'text', scope: 'header' },
  { idx: 4, label: 'Mã KH', kind: 'text', scope: 'header' },
  { idx: 5, label: 'Khách hàng', kind: 'text', scope: 'header' },
  { idx: 6, label: 'Mã SP', kind: 'text', scope: 'item' },
  { idx: 7, label: 'Tên SP', kind: 'text', scope: 'item' },
  { idx: 8, label: 'SLG', kind: 'qty', scope: 'item' },
  { idx: 9, label: 'Đơn giá', kind: 'money', scope: 'item' },
  { idx: 10, label: 'Thành tiền', kind: 'money', scope: 'item' },
  { idx: 11, label: 'Kho', kind: 'text', scope: 'item' },
  { idx: 12, label: 'NV xuất', kind: 'text', scope: 'header' },
  { idx: 13, label: 'Ghi chú', kind: 'text', scope: 'header' },
  { idx: 14, label: 'Loại hình', kind: 'text', scope: 'header' },
  { idx: 15, label: 'SLG xuất', kind: 'qty', scope: 'item' },
  { idx: 16, label: 'Trạng thái', kind: 'text', scope: 'item' }
];

export function getOrderColumns(moduleType = 'XUẤT') {
  const isNhap = (moduleType || '').toString().toUpperCase().includes('NHẬP');
  if (!isNhap) return ORDER_COLUMNS_BASE;
  return ORDER_COLUMNS_BASE.map(c => {
    if (c.idx === 4) return { ...c, label: 'Mã NCC/KH' };
    if (c.idx === 5) return { ...c, label: 'Nhà cung cấp' };
    if (c.idx === 12) return { ...c, label: 'NV nhận' };
    if (c.idx === 15) return { ...c, label: 'Ngày đặt hàng', kind: 'date', scope: 'header' };
    if (c.idx === 16) return { ...c, label: 'Tình trạng' };
    return c;
  });
}

/** Chuẩn hoá giá trị 1 ô để so sánh (cùng ngày khác định dạng => bằng nhau). */
export function normalizeOrderCell(kind, val) {
  if (val === null || val === undefined) return '';
  if (kind === 'qty' || kind === 'money') {
    if (val === '') return '';
    return String(cleanNumber(val));
  }
  if (kind === 'date') {
    const s = val.toString().trim();
    if (!s) return '';
    const d = parseSimpleSheetDate(s);
    if (Number.isNaN(d.getTime())) return s;
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  return val.toString().trim();
}

/** Định dạng giá trị 1 ô để hiển thị cho người dùng. */
export function formatOrderCell(kind, val) {
  if (val === null || val === undefined || val.toString().trim() === '') return '';
  if (kind === 'qty') return formatNumber(cleanNumber(val));
  if (kind === 'money') return formatCurrency(cleanNumber(val));
  if (kind === 'date') return formatDateVN(val);
  return val.toString().trim();
}

/**
 * Đưa dữ liệu cũ/mới trong log về dạng mảng các dòng (mỗi dòng là mảng giá trị).
 * Hỗ trợ: [[...],[...]] (cả đơn), [...] (1 dòng), { rowValues: [...] }.
 * Trả về null nếu không phải dữ liệu dạng dòng của sheet.
 */
export function normalizeAuditRows(data) {
  if (data === null || data === undefined || data === '') return null;
  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    if (data.every(r => Array.isArray(r))) return data;
    if (data.every(v => v === null || typeof v !== 'object')) return [data];
    if (data.every(r => r && Array.isArray(r.rowValues))) return data.map(r => r.rowValues);
    return null;
  }
  if (typeof data === 'object' && Array.isArray(data.rowValues)) return [data.rowValues];
  return null;
}

function itemKeyBase(r) {
  return (r[6] || r[0] || '').toString().trim().toUpperCase();
}

function keyRows(rows) {
  const counts = new Map();
  return rows.map(r => {
    const base = itemKeyBase(r) || '__EMPTY__';
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    return { key: `${base}#${n}`, row: r };
  });
}

function hasCol(row, idx) {
  return Array.isArray(row) && idx < row.length;
}

/**
 * So sánh chi tiết 2 bản chụp của đơn (cũ → mới) theo từng cột và từng sản phẩm.
 */
export function compareOrderRows({ oldRows = [], newRows = [], moduleType = 'XUẤT' }) {
  const columns = getOrderColumns(moduleType);
  const headerCols = columns.filter(c => c.scope === 'header');
  const itemCols = columns.filter(c => c.scope === 'item');
  const oldList = Array.isArray(oldRows) ? oldRows : [];
  const newList = Array.isArray(newRows) ? newRows : [];
  const oldFirst = oldList[0];
  const newFirst = newList[0];
  const bothSides = oldList.length > 0 && newList.length > 0;

  // Thông tin chung của đơn (lấy theo dòng đầu)
  const header = headerCols.map(c => {
    const oldVal = oldFirst && hasCol(oldFirst, c.idx) ? oldFirst[c.idx] : undefined;
    const newVal = newFirst && hasCol(newFirst, c.idx) ? newFirst[c.idx] : undefined;
    const changed = bothSides && hasCol(oldFirst, c.idx) && hasCol(newFirst, c.idx) &&
      normalizeOrderCell(c.kind, oldVal) !== normalizeOrderCell(c.kind, newVal);
    return { ...c, oldVal, newVal, changed };
  });

  // Từng sản phẩm
  const oldKeyed = keyRows(oldList);
  const newKeyed = keyRows(newList);
  const oldMap = new Map(oldKeyed.map(k => [k.key, k.row]));
  const newKeySet = new Set(newKeyed.map(k => k.key));

  const items = [];
  newKeyed.forEach(({ key, row: newRow }) => {
    const oldRow = oldMap.get(key);
    if (!oldRow) {
      items.push({ key, status: 'added', oldRow: null, newRow, changedCols: [] });
      return;
    }
    const changedCols = itemCols
      .filter(c => hasCol(oldRow, c.idx) && hasCol(newRow, c.idx))
      .filter(c => normalizeOrderCell(c.kind, oldRow[c.idx]) !== normalizeOrderCell(c.kind, newRow[c.idx]))
      .map(c => c.idx);
    items.push({ key, status: changedCols.length > 0 ? 'changed' : 'same', oldRow, newRow, changedCols });
  });
  oldKeyed.forEach(({ key, row: oldRow }) => {
    if (!newKeySet.has(key)) {
      items.push({ key, status: 'removed', oldRow, newRow: null, changedCols: [] });
    }
  });

  // Danh sách thay đổi dạng chữ (mỗi thay đổi 1 dòng)
  const changes = [];
  header.filter(h => h.changed).forEach(h => {
    const o = formatOrderCell(h.kind, h.oldVal) || '(trống)';
    const n = formatOrderCell(h.kind, h.newVal) || '(trống)';
    changes.push(`${h.label}: ${o} → ${n}`);
  });

  const colByIdx = new Map(columns.map(c => [c.idx, c]));
  const spName = (r) => (r[7] || r[6] || '').toString().trim() || 'SP';
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  items.forEach(it => {
    counts[it.status] += 1;
    if (!bothSides) return;
    if (it.status === 'added') {
      changes.push(`Thêm SP: ${spName(it.newRow)} (SL ${formatNumber(cleanNumber(it.newRow[8]))})`);
    } else if (it.status === 'removed') {
      changes.push(`Xóa SP: ${spName(it.oldRow)} (SL ${formatNumber(cleanNumber(it.oldRow[8]))})`);
    } else if (it.status === 'changed') {
      // Thành tiền chỉ ghi khi SL / giá không đổi (tránh lặp)
      const cols = it.changedCols.filter(idx => idx !== 10 || !(it.changedCols.includes(8) || it.changedCols.includes(9)));
      const parts = cols.map(idx => {
        const c = colByIdx.get(idx);
        return `${c.label} ${formatOrderCell(c.kind, it.oldRow[idx]) || '(trống)'} → ${formatOrderCell(c.kind, it.newRow[idx]) || '(trống)'}`;
      });
      changes.push(`Sửa SP: ${spName(it.newRow)} — ${parts.join('; ')}`);
    }
  });

  return { columns, header, itemCols, items, counts, changes, bothSides };
}

/**
 * Compares two order snapshots (old vs new) and returns human-readable diff details
 */
export function diffOrderChanges({ oldRows = [], newRows = [], moduleType = 'NHẬP' }) {
  const { changes } = compareOrderRows({ oldRows, newRows, moduleType });
  return {
    diffs: changes,
    summary: changes.length > 0 ? changes.join(' | ') : 'Không có thay đổi'
  };
}

/**
 * Builds standard 12-column row array for sheet LICH_SU
 */
export function buildAuditLogRow({
  user,
  moduleName,
  actionType,
  orderId = '',
  targetObject = '',
  summary = '',
  oldData = null,
  newData = null,
  restoreStatus = 'GỐC'
}) {
  const logId = generateLogId();
  const timeStr = formatDateTime(new Date());
  const userName = user?.name || user?.ho_ten || user?.id || 'Hệ thống';
  const userDisplay = user?.id ? `${user.id} - ${userName}` : userName;
  const userRole = user?.role || user?.quyen || '';

  const cleanOldData = oldData ? (typeof oldData === 'string' ? oldData : JSON.stringify(oldData)) : '';
  const cleanNewData = newData ? (typeof newData === 'string' ? newData : JSON.stringify(newData)) : '';

  return [
    logId,
    timeStr,
    userDisplay,
    userRole,
    moduleName,
    actionType,
    orderId,
    targetObject,
    summary,
    cleanOldData,
    cleanNewData,
    restoreStatus
  ];
}
