'use strict';

// Runs in the existing PDF viewer. Never constructs/replays a signed PDF API URL,
// changes document permissions, or edits the original (possibly watermarked) bytes.
function inspectLoadedPDF() {
  const isViewer = location.origin === 'https://newetds.lib.tsinghua.edu.cn' && location.pathname === '/pdf/generic/web/viewer.html';
  const viewer = isViewer ? window.PDFViewerApplication : null;
  const ready = !!(viewer?.pdfDocument?.numPages && typeof viewer.pdfDocument.getData === 'function');
  let filename = String(viewer?.documentInfo?.Title || viewer?._docFilename || '论文');
  if (/^getPdfStream(?:\.|$)/i.test(filename)) filename = '论文';
  filename = filename.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 140) || '论文';
  if (!/\.pdf$/i.test(filename)) filename += '.pdf';
  return { isViewer, ready, pages: ready ? viewer.pdfDocument.numPages : 0, filename };
}

async function saveLoadedPDF() {
  if (location.origin !== 'https://newetds.lib.tsinghua.edu.cn' || location.pathname !== '/pdf/generic/web/viewer.html') {
    throw new Error('请先打开论文的 PDF 预览标签页');
  }
  const viewer = window.PDFViewerApplication;
  const pdf = viewer?.pdfDocument;
  if (!pdf?.numPages || typeof pdf.getData !== 'function') throw new Error('PDF 尚未加载，请等待页面显示正文后重试');
  let timer;
  let bytes;
  try {
    bytes = await Promise.race([
      pdf.getData(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('读取 PDF 超时，请检查网络后重试')), 90000); })
    ]);
  } finally { clearTimeout(timer); }
  if (window.PDFViewerApplication?.pdfDocument !== pdf) throw new Error('预览文档已切换，请在当前论文页面重新保存');
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || !new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
    throw new Error('当前预览未返回有效 PDF，未保存文件；请检查登录状态');
  }
  let title = String(viewer.documentInfo?.Title || viewer._docFilename || '论文');
  if (/^getPdfStream(?:\.|$)/i.test(title)) title = '论文';
  title = title.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 140) || '论文';
  if (!/\.pdf$/i.test(title)) title += '.pdf';
  // Return the existing typed array to the trusted main process. Do not create an
  // anchor/blob download: Chromium may suppress it, and its dialog appears too late.
  return { filename: title, bytes };
}

module.exports = {
  PDF_STATE_SCRIPT: `(${inspectLoadedPDF.toString()})();`,
  READ_PDF_SCRIPT: `(${saveLoadedPDF.toString()})();`
};
