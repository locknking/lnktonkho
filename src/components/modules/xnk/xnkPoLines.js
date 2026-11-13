import { cleanNumber } from '../../../utils/formatters';
import { extractTiendoMeta } from './xnkStages';

// Cột chuẩn của sheet XNK_DON_HANG_CT (mỗi dòng = 1 sản phẩm trong PO)
// ['ma_po', 'stt', 'id_y_tuong', 'id_mau', 'sku', 'ten_sp', 'so_luong', 'don_gia', 'thanh_tien', 'slg_thuc_nhan', 'ghi_chu']

const norm = (v) => (v === undefined || v === null ? '' : String(v)).trim();

// ---------------------------------------------------------------------
// Tiền tệ đơn giá (VND / USD) + số thập phân
// Lưu kèm trong cột ghi_chu của dòng SP: "<ghi chú> [gia:tt=USD;dg=15.05]"
// (cột don_gia trên Sheets có thể bị định dạng lại nên giữ bản chính xác ở đây)
// ---------------------------------------------------------------------
export const CURRENCIES = { VND: 'VND', USD: 'USD' };
const round3 = (n) => Math.round(n * 1000) / 1000;

// "15,05" | "15.05" | "30,115" -> số; rỗng -> ''
export function parseMoneyInput(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return Number.isFinite(val) ? val : '';
  const s = String(val).replace(/\s/g, '').replace(',', '.');
  if (s === '' || s === '.') return '';
  const n = parseFloat(s);
  return Number.isNaN(n) ? '' : n;
}

// Chỉ cho gõ số + 1 dấu thập phân (, hoặc .), tối đa 3 chữ số thập phân
export function sanitizeMoneyInput(raw) {
  let s = String(raw || '').replace(/[^0-9.,]/g, '');
  const i = s.search(/[.,]/);
  if (i === -1) return s;
  const intPart = s.slice(0, i);
  const dec = s.slice(i + 1).replace(/[.,]/g, '').slice(0, 3);
  return `${intPart || '0'},${dec}`;
}

// Hiển thị số trong ô nhập (dấu phẩy thập phân)
export function moneyToInput(n) {
  if (n === '' || n === null || n === undefined) return '';
  return String(n).replace('.', ',');
}

export function formatMoney(num, currency = CURRENCIES.VND) {
  const val = Number(num);
  const safe = Number.isFinite(val) ? val : 0;
  if (currency === CURRENCIES.USD) {
    return '$' + safe.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }
  return safe.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + ' ₫';
}

export function lineCurrency(line) {
  return line && line.tien_te === CURRENCIES.USD ? CURRENCIES.USD : CURRENCIES.VND;
}

export function lineAmount(line) {
  const sl = cleanNumber(line?.so_luong) || 0;
  const dg = parseMoneyInput(line?.don_gia) || 0;
  return round3(sl * dg);
}

function extractLineMeta(ghiChu) {
  const m = String(ghiChu || '').match(/\[gia:([^\]]+)\]/);
  if (!m) return {};
  const meta = {};
  m[1].split(';').forEach(p => {
    const [k, v] = p.split('=');
    if (k && v !== undefined) meta[k.trim()] = v.trim();
  });
  return meta;
}

export function stripLineMeta(ghiChu) {
  return String(ghiChu || '').replace(/\s*\[gia:[^\]]+\]\s*/g, '').trim();
}

// Ghép ghi chú dòng SP + metadata tiền tệ (chỉ ghi khi là USD hoặc có số lẻ)
export function buildLineGhiChu(note, currency, donGia) {
  const clean = stripLineMeta(note);
  const dg = parseMoneyInput(donGia);
  const needMeta = currency === CURRENCIES.USD || (dg !== '' && !Number.isInteger(dg));
  if (!needMeta) return clean;
  const meta = `[gia:tt=${currency === CURRENCIES.USD ? 'USD' : 'VND'};dg=${dg === '' ? 0 : dg}]`;
  return clean ? `${clean} ${meta}` : meta;
}
const poKey = (maPo) => norm(maPo).toUpperCase();

// Gom các dòng chi tiết theo mã PO -> { [MA_PO]: [{ _sheetRow, ...line }] }
export function buildPoLinesMap(ctData) {
  const map = {};
  if (!ctData || ctData.length <= 1) return map;
  ctData.slice(1).forEach((r, idx) => {
    const key = poKey(r[0]);
    if (!key) return;
    const meta = extractLineMeta(r[10]);
    const metaDg = meta.dg !== undefined ? parseMoneyInput(meta.dg) : '';
    const soLuong = cleanNumber(r[6]) || 0;
    const donGia = metaDg !== '' ? metaDg : (cleanNumber(r[7]) || 0);
    const line = {
      _sheetRow: idx + 2,
      ma_po: norm(r[0]),
      stt: cleanNumber(r[1]) || 0,
      id_y_tuong: norm(r[2]),
      id_mau: norm(r[3]),
      sku: norm(r[4]),
      ten_sp: norm(r[5]),
      so_luong: soLuong,
      don_gia: donGia,
      tien_te: meta.tt === 'USD' ? CURRENCIES.USD : CURRENCIES.VND,
      thanh_tien: metaDg !== '' ? round3(soLuong * metaDg) : (cleanNumber(r[8]) || 0),
      slg_thuc_nhan: r[9] !== undefined && r[9] !== '' ? cleanNumber(r[9]) : '',
      ghi_chu: stripLineMeta(r[10])
    };
    if (!line.sku && !line.ten_sp && !line.id_mau && !line.id_y_tuong) return;
    (map[key] = map[key] || []).push(line);
  });
  Object.values(map).forEach(lines => lines.sort((a, b) => a.stt - b.stt));
  return map;
}

// Danh sách SP của 1 PO. PO cũ (chưa có dòng chi tiết) được coi là 1 dòng lấy từ chính dòng PO.
export function getPoLines(order, linesMap) {
  if (!order) return [];
  const lines = linesMap && linesMap[poKey(order.ma_po)];
  if (lines && lines.length > 0) return lines;
  return [{
    _sheetRow: null,
    ma_po: norm(order.ma_po),
    stt: 1,
    id_y_tuong: '',
    id_mau: norm(order.id_mau),
    sku: norm(order.sku),
    ten_sp: norm(order.ten_sp),
    so_luong: cleanNumber(order.so_luong) || 0,
    don_gia: cleanNumber(order.don_gia) || 0,
    tien_te: CURRENCIES.VND,
    thanh_tien: cleanNumber(order.tong_tien) || 0,
    slg_thuc_nhan: order.slg_thuc_nhan !== undefined ? order.slg_thuc_nhan : '',
    ghi_chu: ''
  }];
}

// Tóm tắt nhiều dòng SP thành các cột của dòng PO (giữ tương thích với các màn hình đọc XNK_DON_HANG)
export function summarizePoLines(lines) {
  const valid = (lines || []).filter(l => norm(l.sku) || norm(l.ten_sp));
  const uniq = (arr) => Array.from(new Set(arr.map(norm).filter(Boolean)));
  const soLuong = valid.reduce((s, l) => s + (cleanNumber(l.so_luong) || 0), 0);
  // Tổng tiền tách theo tiền tệ (không quy đổi tỷ giá)
  const tongTien = round3(valid.filter(l => lineCurrency(l) === CURRENCIES.VND).reduce((s, l) => s + lineAmount(l), 0));
  const tongTienUsd = round3(valid.filter(l => lineCurrency(l) === CURRENCIES.USD).reduce((s, l) => s + lineAmount(l), 0));
  const hasNhan = valid.some(l => l.slg_thuc_nhan !== '' && l.slg_thuc_nhan !== undefined && l.slg_thuc_nhan !== null);
  const slgThucNhan = hasNhan ? valid.reduce((s, l) => s + (cleanNumber(l.slg_thuc_nhan) || 0), 0) : '';
  const firstName = norm(valid[0]?.ten_sp);

  return {
    id_mau: uniq(valid.map(l => l.id_mau)).join(', '),
    sku: uniq(valid.map(l => l.sku)).join(', '),
    ten_sp: valid.length > 1 ? `${firstName} (+${valid.length - 1} SP khác)` : firstName,
    so_luong: soLuong,
    don_gia: valid.length === 1 ? (parseMoneyInput(valid[0].don_gia) || 0) : '',
    tong_tien: tongTien,
    tong_tien_usd: tongTienUsd,
    slg_thuc_nhan: slgThucNhan
  };
}

// Tiền của 1 PO theo đúng đơn vị (VND/USD) và số lẻ: ưu tiên dữ liệu chi tiết SP + meta ghi chú PO
export function getPoMoney(order, linesMap) {
  const meta = extractTiendoMeta(order && order.ghi_chu);
  const lines = getPoLines(order, linesMap).filter(l => norm(l.sku) || norm(l.ten_sp));
  const currency = meta.tt === 'USD' || (!meta.tt && lines.some(l => lineCurrency(l) === CURRENCIES.USD))
    ? CURRENCIES.USD : CURRENCIES.VND;
  const hasCt = lines.some(l => l._sheetRow);
  const tongTien = hasCt
    ? round3(lines.filter(l => lineCurrency(l) === currency).reduce((s, l) => s + lineAmount(l), 0))
    : (cleanNumber(order && order.tong_tien) || 0);
  const donGia = lines.length === 1 ? (parseMoneyInput(lines[0].don_gia) || 0) : (cleanNumber(order && order.don_gia) || 0);
  const cocMeta = meta.cocv !== undefined ? parseMoneyInput(meta.cocv) : '';
  const tienCoc = cocMeta !== '' ? cocMeta : (cleanNumber(order && order.tien_coc) || 0);
  return { currency, don_gia: donGia, tong_tien: tongTien, tien_coc: tienCoc };
}

// Kiểm tra PO có chứa ít nhất 1 dòng SP thoả điều kiện `match(line)` hay không
export function poHasLine(order, linesMap, match) {
  return getPoLines(order, linesMap).some(match);
}

// Xoá các dòng chi tiết SP của 1 PO (gọi khi xoá PO)
export async function deletePoLines(maPo, linesMap, deleteRow) {
  const lines = (linesMap && linesMap[poKey(maPo)]) || [];
  for (const line of lines) {
    if (line._sheetRow) await deleteRow('xnk_donhang_ct', line._sheetRow);
  }
}
