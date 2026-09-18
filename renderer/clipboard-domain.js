const NotchClipboardDomain = Object.freeze({
  dayKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  formatDay(timestamp, now = Date.now()) {
    const date = new Date(timestamp);
    const today = new Date(now);
    const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayDifference = Math.round((currentDay - targetDay) / 86400000);
    if (dayDifference === 0) return '今天';
    if (dayDifference === 1) return '昨天';
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    return date.getFullYear() === today.getFullYear()
      ? `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`
      : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
  },

  formatMoment(timestamp, now = Date.now()) {
    const date = new Date(timestamp);
    const difference = Math.max(0, now - timestamp);
    let relative = '';
    if (difference < 60000) relative = '刚刚';
    else if (difference < 3600000) relative = `${Math.floor(difference / 60000)} 分钟前`;
    else if (difference < 86400000) relative = `${Math.floor(difference / 3600000)} 小时前`;
    const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const full = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
    return { clock, relative, full, iso: date.toISOString() };
  },

  groupByDay(items) {
    const groups = [];
    const groupsByKey = new Map();
    items.forEach((entry) => {
      const key = this.dayKey(entry.timestamp);
      const existing = groupsByKey.get(key);
      if (existing) {
        existing.items.push(entry);
        return;
      }
      const group = { key, timestamp: entry.timestamp, items: [entry] };
      groupsByKey.set(key, group);
      groups.push(group);
    });
    return groups;
  },
});
window.NotchClipboardDomain = NotchClipboardDomain;
