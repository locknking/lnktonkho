import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal } from './Modal';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { 
  History, 
  Search, 
  RotateCcw, 
  RefreshCw, 
  Eye, 
  CheckCircle2, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar
} from 'lucide-react';
import { matchesSearch, cleanNumber, formatNumber, formatCurrency } from '../../utils/formatters';
import { compareOrderRows, normalizeAuditRows, formatOrderCell } from '../../services/auditLogService';

const ORDER_MODULES = ['NHẬP', 'XUẤT'];

const CHIP_TONES = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  gray: 'bg-slate-50 text-slate-600 border-slate-200'
};

// "Ngày" -> "ngày", nhưng giữ nguyên "NV xuất", "SLG"
function lowerFirst(label) {
  if (!label || label.length < 2) return label;
  const second = label.charAt(1);
  return second !== second.toUpperCase() ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

const sumQty = (rows) => rows.reduce((acc, r) => acc + (cleanNumber(r[8]) || 0), 0);
const sumMoney = (rows) => rows.reduce((acc, r) => acc + (cleanNumber(r[10]) || 0), 0);
const spName = (r) => (r[7] || r[6] || '').toString().trim() || 'SP';

/**
 * Tính lại so sánh từ dữ liệu cũ/mới của log để hiển thị chip tóm tắt + danh sách thay đổi.
 * Tính từ dữ liệu (không dựa vào chuỗi tóm tắt) nên log cũ cũng không còn "thay đổi giả".
 */
function buildLogInsight(item) {
  const fallbackLines = (item.tomTat || '').toString().split(' | ').map(s => s.trim()).filter(Boolean);
  const oldRows = normalizeAuditRows(item.oldData);
  const newRows = normalizeAuditRows(item.newData);
  if (!ORDER_MODULES.includes(item.phanHe) || (!oldRows && !newRows)) {
    return { comparison: null, chips: [], lines: fallbackLines };
  }

  const comparison = compareOrderRows({
    oldRows: oldRows || [],
    newRows: newRows || [],
    moduleType: item.phanHe
  });
  const { counts, header, items } = comparison;
  const chips = [];
  let lines = [];

  if (comparison.bothSides) {
    header.filter(h => h.changed).forEach(h => {
      chips.push({ tone: 'blue', text: `Đổi ${lowerFirst(h.label)}` });
    });
    if (counts.added) chips.push({ tone: 'green', text: `+${counts.added} SP` });
    if (counts.removed) chips.push({ tone: 'red', text: `−${counts.removed} SP` });
    if (counts.changed) {
      const changedItems = items.filter(i => i.status === 'changed');
      const onlyStatus = changedItems.every(i => i.changedCols.every(idx => idx === 15 || idx === 16));
      chips.push({
        tone: 'amber',
        text: onlyStatus
          ? (counts.changed === 1 ? 'Đổi trạng thái kho' : `Đổi trạng thái ${counts.changed} SP`)
          : `Sửa ${counts.changed} SP`
      });
    }
    if (chips.length === 0) chips.push({ tone: 'gray', text: 'Không có thay đổi' });
    lines = comparison.changes.length > 0
      ? comparison.changes
      : ['Không có thay đổi thực sự (chỉ lưu lại đơn)'];
  } else {
    const rows = (newRows && newRows.length > 0) ? newRows : (oldRows || []);
    const isAdd = newRows && newRows.length > 0;
    if (item.thaoTac === 'IMPORT_EXCEL') {
      chips.push({ tone: 'green', text: `${rows.length} dòng` });
    } else {
      chips.push({ tone: isAdd ? 'green' : 'red', text: `${isAdd ? '+' : '−'}${rows.length} SP` });
    }
    chips.push({ tone: 'gray', text: `SL ${formatNumber(sumQty(rows))}` });
    const money = sumMoney(rows);
    if (money) chips.push({ tone: 'gray', text: formatCurrency(money) });
    lines = rows.map(r => `${isAdd ? 'Thêm' : 'Xóa'} SP: ${spName(r)} (SL ${formatNumber(cleanNumber(r[8]))})`);
  }

  return { comparison, chips, lines };
}

function Chip({ tone = 'gray', children }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10.5px] font-semibold whitespace-nowrap ${CHIP_TONES[tone] || CHIP_TONES.gray}`}>
      {children}
    </span>
  );
}

const ITEM_STATUS = {
  added: { label: 'Thêm', row: 'bg-emerald-50/70', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  removed: { label: 'Xóa', row: 'bg-rose-50/70', badge: 'bg-rose-100 text-rose-800 border-rose-200' },
  changed: { label: 'Sửa', row: 'bg-amber-50/60', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  same: { label: 'Giữ nguyên', row: 'opacity-60', badge: 'bg-slate-100 text-slate-500 border-slate-200' }
};

function ChangedValue({ kind, oldVal, newVal }) {
  const o = formatOrderCell(kind, oldVal);
  const n = formatOrderCell(kind, newVal);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className="line-through decoration-rose-400 text-rose-600/80">{o || '(trống)'}</span>
      <span className="text-slate-400">→</span>
      <span className="font-semibold text-emerald-700">{n || '(trống)'}</span>
    </span>
  );
}

function OrderComparison({ comparison }) {
  const [hideUnchanged, setHideUnchanged] = useState(false);
  const { header, itemCols, items, counts, bothSides } = comparison;

  const hasValue = (v) => v !== undefined && v !== null && v.toString().trim() !== '';
  const headerShown = header.filter(h => h.changed || hasValue(h.newVal) || hasValue(h.oldVal));
  const alwaysCols = [6, 7, 8, 9, 10];
  const colsShown = itemCols.filter(c =>
    alwaysCols.includes(c.idx) ||
    items.some(it => hasValue(it.newRow?.[c.idx]) || hasValue(it.oldRow?.[c.idx]))
  );
  const visibleItems = hideUnchanged ? items.filter(it => it.status !== 'same') : items;

  const oldRows = items.filter(it => it.oldRow).map(it => it.oldRow);
  const newRows = items.filter(it => it.newRow).map(it => it.newRow);
  const totalCols = [
    { label: 'Tổng SL', kind: 'qty', o: sumQty(oldRows), n: sumQty(newRows) },
    { label: 'Tổng tiền', kind: 'money', o: sumMoney(oldRows), n: sumMoney(newRows) }
  ];

  return (
    <div className="space-y-3">
      {/* Thông tin chung */}
      {headerShown.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Thông tin chung</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 text-xs">
            {headerShown.map(h => (
              <div key={h.idx} className={`min-w-0 rounded px-2 py-1 ${h.changed ? 'bg-sky-50 ring-1 ring-sky-200' : ''}`}>
                <div className="text-[10.5px] text-slate-500">{h.label}{h.changed && <span className="ml-1 text-sky-700 font-semibold">• đã đổi</span>}</div>
                <div className="text-slate-800 font-medium break-words">
                  {h.changed
                    ? <ChangedValue kind={h.kind} oldVal={h.oldVal} newVal={h.newVal} />
                    : (formatOrderCell(h.kind, hasValue(h.newVal) ? h.newVal : h.oldVal) || '—')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bảng sản phẩm */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-bold text-slate-500 uppercase tracking-wide mr-1">Sản phẩm</span>
            {counts.added > 0 && <Chip tone="green">Thêm {counts.added}</Chip>}
            {counts.removed > 0 && <Chip tone="red">Xóa {counts.removed}</Chip>}
            {counts.changed > 0 && <Chip tone="amber">Sửa {counts.changed}</Chip>}
            {bothSides && counts.same > 0 && <Chip tone="gray">Giữ nguyên {counts.same}</Chip>}
          </div>
          {bothSides && counts.same > 0 && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideUnchanged}
                onChange={(e) => setHideUnchanged(e.target.checked)}
                className="rounded border-slate-300"
              />
              Ẩn dòng không đổi
            </label>
          )}
        </div>
        <div className="overflow-x-auto max-h-[45vh]">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 text-[11px] sticky top-0">
              <tr>
                <th className="py-2 px-2 text-left font-semibold w-20">Thay đổi</th>
                {colsShown.map(c => (
                  <th
                    key={c.idx}
                    className={`py-2 px-2 font-semibold whitespace-nowrap ${c.kind === 'qty' || c.kind === 'money' ? 'text-right' : 'text-left'}`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={colsShown.length + 1} className="py-6 text-center text-slate-400">
                    Không có dòng sản phẩm nào thay đổi.
                  </td>
                </tr>
              ) : visibleItems.map(it => {
                const st = ITEM_STATUS[it.status];
                const row = it.newRow || it.oldRow;
                return (
                  <tr key={it.key} className={st.row}>
                    <td className="py-1.5 px-2 whitespace-nowrap">
                      <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10.5px] font-semibold ${st.badge}`}>
                        {st.label}
                      </span>
                    </td>
                    {colsShown.map(c => {
                      const isNum = c.kind === 'qty' || c.kind === 'money';
                      const changed = it.changedCols.includes(c.idx);
                      return (
                        <td
                          key={c.idx}
                          className={`py-1.5 px-2 ${isNum ? 'text-right tabular-nums whitespace-nowrap' : ''} ${c.idx === 7 ? 'min-w-[180px]' : ''} ${changed ? 'bg-amber-100/70' : ''} ${it.status === 'removed' ? 'text-rose-800' : 'text-slate-700'}`}
                        >
                          {changed
                            ? <ChangedValue kind={c.kind} oldVal={it.oldRow[c.idx]} newVal={it.newRow[c.idx]} />
                            : (formatOrderCell(c.kind, row[c.idx]) || <span className="text-slate-300">—</span>)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Tổng */}
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 px-3 py-2 border-t border-slate-100 bg-slate-50 text-xs">
          {totalCols.map(t => (
            <div key={t.label} className="flex items-center gap-1.5">
              <span className="text-slate-500">{t.label}:</span>
              {bothSides && t.o !== t.n
                ? <ChangedValue kind={t.kind} oldVal={t.o} newVal={t.n} />
                : <span className="font-semibold text-slate-800">{formatOrderCell(t.kind, bothSides || newRows.length ? t.n : t.o) || '0'}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RawDataPanel({ oldData, newData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="p-3 bg-rose-50/50 border border-rose-200 rounded-lg">
        <div className="text-xs font-bold text-rose-800 mb-2">Dữ liệu cũ (trước khi thay đổi / đã xóa)</div>
        <pre className="text-[11px] font-mono text-slate-700 bg-white p-2.5 rounded border border-rose-100 overflow-x-auto max-h-56 leading-relaxed">
          {oldData ? JSON.stringify(oldData, null, 2) : '(Không có dữ liệu cũ - Thêm mới)'}
        </pre>
      </div>
      <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-lg">
        <div className="text-xs font-bold text-emerald-800 mb-2">Dữ liệu mới (sau khi thay đổi)</div>
        <pre className="text-[11px] font-mono text-slate-700 bg-white p-2.5 rounded border border-emerald-100 overflow-x-auto max-h-56 leading-relaxed">
          {newData ? JSON.stringify(newData, null, 2) : '(Không có dữ liệu mới - Thao tác Xóa)'}
        </pre>
      </div>
    </div>
  );
}

const ACTION_COLORS = {
  'THÊM_MỚI': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'CHỈNH_SỬA': 'bg-blue-50 text-blue-700 border-blue-200',
  'XÓA_DÒNG': 'bg-rose-50 text-rose-700 border-rose-200',
  'XÓA_ĐƠN': 'bg-red-50 text-red-700 border-red-200',
  'IMPORT_EXCEL': 'bg-purple-50 text-purple-700 border-purple-200',
  'KHÔI_PHỤC': 'bg-amber-50 text-amber-700 border-amber-200'
};

export function HistoryModal({
  isOpen,
  onClose,
  defaultModule = '',
  defaultOrderId = '',
  title = 'Lịch sử thay đổi & thao tác'
}) {
  const { lichSuData, fetchLichSuData, rollbackAuditAction } = useData();
  const { currentUser, hasRole } = useAuth();

  const [searchTerm, setSearchTerm] = useState(defaultOrderId || '');
  const [selectedAction, setSelectedAction] = useState('ALL');
  const [selectedModule, setSelectedModule] = useState(defaultModule || 'ALL');
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [inspectRow, setInspectRow] = useState(null);

  useEffect(() => {
    if (isOpen) {
      if (defaultOrderId) setSearchTerm(defaultOrderId);
      if (defaultModule) setSelectedModule(defaultModule);
      if (fetchLichSuData) {
        fetchLichSuData(false).catch(() => {});
      }
    }
  }, [isOpen, defaultOrderId, defaultModule, fetchLichSuData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (fetchLichSuData) await fetchLichSuData(true);
    } catch (e) {
      console.warn('Refresh lich su failed:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Parse logs from lichSuData (skip header row if present)
  const logs = useMemo(() => {
    if (!lichSuData || !Array.isArray(lichSuData)) return [];
    const rows = lichSuData.slice(1); // skip header row
    return rows.map((r, idx) => {
      const [
        id, thoiGian, nguoiDung, vaiTro, phanHe, thaoTac,
        maDon, doiTuong, tomTat, duLieuCuRaw, duLieuMoiRaw, trangThaiKhoiPhuc
      ] = r || [];

      let oldData = null;
      let newData = null;
      try {
        if (duLieuCuRaw) oldData = JSON.parse(duLieuCuRaw);
      } catch (e) {
        oldData = duLieuCuRaw;
      }
      try {
        if (duLieuMoiRaw) newData = JSON.parse(duLieuMoiRaw);
      } catch (e) {
        newData = duLieuMoiRaw;
      }

      const base = {
        rawRow: r,
        id: id || `LOG_${idx}`,
        thoiGian: thoiGian || '',
        nguoiDung: nguoiDung || '',
        vaiTro: vaiTro || '',
        phanHe: (phanHe || '').toString().trim().toUpperCase(),
        thaoTac: (thaoTac || '').toString().trim().toUpperCase(),
        maDon: (maDon || '').toString().trim(),
        doiTuong: doiTuong || '',
        tomTat: tomTat || '',
        oldData,
        newData,
        trangThaiKhoiPhuc: (trangThaiKhoiPhuc || 'GỐC').toString().trim()
      };
      let insight;
      try {
        insight = buildLogInsight(base);
      } catch (e) {
        insight = { comparison: null, chips: [], lines: [base.tomTat].filter(Boolean) };
      }
      return { ...base, insight };
    });
  }, [lichSuData]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter(item => {
      if (selectedModule !== 'ALL' && item.phanHe !== selectedModule) {
        return false;
      }
      if (selectedAction !== 'ALL' && item.thaoTac !== selectedAction) {
        return false;
      }
      if (searchTerm) {
        const text = `${item.maDon} ${item.doiTuong} ${item.tomTat} ${item.insight.lines.join(" ")} ${item.nguoiDung} ${item.thoiGian}`;
        if (!matchesSearch(text, searchTerm)) return false;
      }
      return true;
    });
  }, [logs, selectedModule, selectedAction, searchTerm]);

  // Handle Rollback
  const handleRollback = async (logItem) => {
    if (!logItem.oldData) {
      alert('Bản ghi này không có dữ liệu cũ để khôi phục.');
      return;
    }
    if (logItem.trangThaiKhoiPhuc.startsWith('ĐÃ_KHÔI_PHỤC')) {
      alert('Thao tác này đã được khôi phục trước đó.');
      return;
    }

    const confirmMsg = `Bạn có chắc chắn muốn KHÔI PHỤC lại thao tác [${logItem.thaoTac}] của đơn ${logItem.maDon || ''}?\n\nNội dung: ${logItem.tomTat}`;
    if (!window.confirm(confirmMsg)) return;

    setIsRollingBack(true);
    try {
      await rollbackAuditAction(logItem.rawRow);
      alert('Khôi phục thành công!');
    } catch (err) {
      alert('Lỗi khi khôi phục: ' + (err.message || err));
    } finally {
      setIsRollingBack(false);
    }
  };

  const isAdminOrManager = currentUser?.role === 'ADMIN' || currentUser?.role === 'QUẢN LÝ' || !currentUser?.role;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-blue-600" />
          <span>{title}</span>
          {defaultOrderId && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-100 text-blue-800">
              {defaultOrderId}
            </span>
          )}
        </div>
      }
      maxWidth="max-w-6xl"
    >
      <div className="space-y-4">
        {/* Filters Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            {/* Search Box */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm mã đơn, sản phẩm, nhân viên..."
                className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Module Filter (if not locked) */}
            {!defaultModule && (
              <select
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">Tất cả phân hệ</option>
                <option value="NHẬP">Nhập kho</option>
                <option value="XUẤT">Xuất kho</option>
              </select>
            )}

            {/* Action Filter */}
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">Tất cả thao tác</option>
              <option value="THÊM_MỚI">Thêm mới</option>
              <option value="CHỈNH_SỬA">Chỉnh sửa</option>
              <option value="XÓA_DÒNG">Xóa dòng</option>
              <option value="XÓA_ĐƠN">Xóa đơn</option>
              <option value="IMPORT_EXCEL">Import Excel</option>
              <option value="KHÔI_PHỤC">Khôi phục</option>
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">
              {filteredLogs.length} bản ghi
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
              title="Làm mới lịch sử"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
              Làm mới
            </button>
          </div>
        </div>

        {/* History List Table */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="overflow-x-auto max-h-[58vh]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100/90 text-slate-700 font-semibold sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-2.5 px-3 w-36">Thời gian</th>
                  <th className="py-2.5 px-3 w-40">Người thực hiện</th>
                  <th className="py-2.5 px-3 w-28">Thao tác</th>
                  <th className="py-2.5 px-3 w-32">Mã đơn</th>
                  <th className="py-2.5 px-4">Tóm tắt nội dung</th>
                  <th className="py-2.5 px-3 w-32 text-center">Trạng thái</th>
                  <th className="py-2.5 px-3 w-24 text-right">Xử lý</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-normal">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <History className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
                      Chưa có lịch sử thao tác nào được ghi nhận.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((item) => {
                    const isExpanded = expandedLogId === item.id;
                    const isRestored = item.trangThaiKhoiPhuc.startsWith('ĐÃ_KHÔI_PHỤC');
                    const badgeClass = ACTION_COLORS[item.thaoTac] || 'bg-slate-100 text-slate-700 border-slate-200';

                    return (
                      <React.Fragment key={item.id}>
                        <tr className={`hover:bg-blue-50/40 transition-colors ${isExpanded ? 'bg-blue-50/20' : ''}`}>
                          {/* Thời gian */}
                          <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap font-mono text-[11px]">
                            {item.thoiGian}
                          </td>

                          {/* Người thực hiện */}
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-800 truncate max-w-[150px]">
                              {item.nguoiDung}
                            </div>
                            {item.vaiTro && (
                              <span className="text-[10px] text-slate-400 font-medium">
                                ({item.vaiTro})
                              </span>
                            )}
                          </td>

                          {/* Thao tác */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeClass}`}>
                              {item.thaoTac}
                            </span>
                          </td>

                          {/* Mã đơn */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-semibold text-slate-700">
                            {item.maDon || '-'}
                          </td>

                          {/* Tóm tắt */}
                          <td className="py-2.5 px-4 text-slate-700" title={item.insight.lines.join('\n') || item.tomTat}>
                            {item.insight.chips.length > 0 ? (
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  {item.insight.chips.map((c, i) => (
                                    <Chip key={i} tone={c.tone}>{c.text}</Chip>
                                  ))}
                                </div>
                                {item.insight.lines.length > 0 && (
                                  <div className="text-[11px] text-slate-500 truncate max-w-[360px]">
                                    {item.insight.lines[0]}
                                    {item.insight.lines.length > 1 && (
                                      <span className="text-slate-400"> · +{item.insight.lines.length - 1} thay đổi khác</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="line-clamp-2">{item.tomTat}</div>
                            )}
                          </td>

                          {/* Trạng thái */}
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            {isRestored ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800">
                                <RotateCcw className="w-2.5 h-2.5" />
                                Đã khôi phục
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                                Gốc
                              </span>
                            )}
                          </td>

                          {/* Nút hành động */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {/* Xem chi tiết so sánh */}
                              {(item.oldData || item.newData) && (
                                <button
                                  type="button"
                                  onClick={() => setInspectRow(inspectRow?.id === item.id ? null : item)}
                                  className="p-1 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded transition"
                                  title="Xem dữ liệu so sánh chi tiết"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Nút khôi phục */}
                              {isAdminOrManager && item.oldData && !isRestored && item.thaoTac !== 'KHÔI_PHỤC' && (
                                <button
                                  type="button"
                                  onClick={() => handleRollback(item)}
                                  disabled={isRollingBack}
                                  className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded transition disabled:opacity-50"
                                  title="Khôi phục lại dữ liệu trước thao tác này"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Undo
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detailed Inspection Modal (Diff Comparison) */}
        {inspectRow && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800 text-sm">
                  Chi tiết bản ghi: {inspectRow.maDon || inspectRow.id}
                </span>
                <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${ACTION_COLORS[inspectRow.thaoTac] || 'bg-slate-100 text-slate-700'}`}>
                  {inspectRow.thaoTac}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setInspectRow(null)}
                className="text-xs text-slate-500 hover:text-slate-800 font-medium"
              >
                ✕ Đóng xem chi tiết
              </button>
            </div>

            {inspectRow.insight.comparison ? (
              <div className="space-y-3">
                {inspectRow.insight.comparison.bothSides && (
                  <div className="bg-white border border-slate-200 rounded-lg p-3">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      Các thay đổi ({inspectRow.insight.comparison.changes.length})
                    </div>
                    {inspectRow.insight.comparison.changes.length > 0 ? (
                      <ul className="space-y-1 text-xs text-slate-700">
                        {inspectRow.insight.comparison.changes.map((line, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-slate-400 select-none">•</span>
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-xs text-slate-500">Không có thay đổi thực sự — đơn chỉ được lưu lại.</div>
                    )}
                  </div>
                )}
                <OrderComparison key={inspectRow.id} comparison={inspectRow.insight.comparison} />
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-600 select-none">Xem dữ liệu gốc (kỹ thuật)</summary>
                  <div className="mt-2">
                    <RawDataPanel oldData={inspectRow.oldData} newData={inspectRow.newData} />
                  </div>
                </details>
              </div>
            ) : (
              <RawDataPanel oldData={inspectRow.oldData} newData={inspectRow.newData} />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
