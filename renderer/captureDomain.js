(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaptureDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function cropRect(start, end, rect, width, height) {
    if (!(rect.width > 0 && rect.height > 0 && width > 0 && height > 0)) return null;
    const x = (point) => Math.max(0, Math.min(width, (point.x - rect.left) * width / rect.width));
    const y = (point) => Math.max(0, Math.min(height, (point.y - rect.top) * height / rect.height));
    const left = Math.floor(Math.min(x(start), x(end))), top = Math.floor(Math.min(y(start), y(end)));
    const right = Math.ceil(Math.max(x(start), x(end))), bottom = Math.ceil(Math.max(y(start), y(end)));
    return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  }
  function videoSize(width, height, quality) {
    const maximum = quality === '720' ? 720 : quality === '1080' ? 1080 : Infinity;
    const scale = Math.min(1, maximum / height, maximum * 16 / 9 / width);
    return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2) };
  }
  function validRegion(rect, width, height) {
    return !!rect && [rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isSafeInteger)
      && width > 0 && height > 0 && width <= 32768 && height <= 32768
      && rect.x >= 0 && rect.y >= 0 && rect.width >= 2 && rect.height >= 2
      && rect.x + rect.width <= width && rect.y + rect.height <= height;
  }
  function normalizeRegion(value) {
    if (!value || typeof value.displayId !== 'string' || !/^-?\d{1,20}$/.test(value.displayId)
      || !validRegion(value, value.frameWidth, value.frameHeight)
      || ![value.displayWidth, value.displayHeight].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 32768)
      || !Number.isFinite(value.scaleFactor) || value.scaleFactor <= 0 || value.scaleFactor > 8
      || ![0, 90, 180, 270].includes(value.rotation)) return null;
    const { displayId, displayWidth, displayHeight, scaleFactor, rotation, frameWidth, frameHeight, x, y, width, height } = value;
    return { displayId, displayWidth, displayHeight, scaleFactor, rotation, frameWidth, frameHeight, x, y, width, height };
  }
  function matchingRegion(value, display, frame) {
    const region = normalizeRegion(value);
    return region && display && region.displayId === String(display.id)
      && region.displayWidth === display.size.width && region.displayHeight === display.size.height
      && region.scaleFactor === display.scaleFactor && region.rotation === display.rotation
      && region.frameWidth === frame.width && region.frameHeight === frame.height ? region : null;
  }
  function message(code) {
    return ({ busy: '已有录音或采集任务，请先结束当前任务。', screen_denied: '屏幕录制权限未开启，请在系统设置中授权后重试。',
      permission_denied: '未获得屏幕或麦克风权限，已取消采集。', no_frames: '没有取得有效画面，请确认来源仍然可见后重试。',
      source_expired: '采集来源已过期，请重新选择。', queue_limit: '视频写入跟不上采集速度，已停止。未完成文件保留在资料库中。',
      source_not_capturable: '此窗口当前无法采集。请恢复窗口后刷新，或手动切换到整个屏幕 / 框选区域。',
      region_changed: '显示器或画面尺寸已变化，已停止区域采集，请重新选择区域。',
      region_display_unknown: '无法确定画面对应的显示器，请刷新来源或改用整屏采集。',
      invalid_region: '区域必须在当前画面内，宽度和高度至少为 2 像素。',
      video_limit: '视频已达到大小上限，未完成文件保留在资料库中。', capture_crashed: '采集进程中断，未完成文件已保留。',
      stop_timeout: '保存超时，已停止采集。未完成文件可导出尝试恢复。', unsupported_codec: '当前设备没有可用的 WebM 视频编码器。',
      file_missing: '文件不存在，可能已在应用外移动或删除。', library_full: '采集资料库已达到 5000 项上限，请先整理文件。',
      screen_locked: '锁屏时已停止采集。', system_sleep: '系统休眠时已停止采集。', display_changed: '显示器发生变化，已停止采集。',
      source_ended: '采集来源已关闭。', write_failed: '文件写入失败，请检查磁盘空间和目录权限。',
    })[code] || '采集操作失败，请检查权限、磁盘空间或重新选择来源。';
  }
  return { cropRect, videoSize, validRegion, normalizeRegion, matchingRegion, message };
});
