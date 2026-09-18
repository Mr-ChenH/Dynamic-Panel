function registerHomeIpc({ ipcMain, weatherService, musicLibrary, showOwnedOpenDialog }) {
  ipcMain.handle('home:weather-search', (_event, query) => weatherService.search(query));
  ipcMain.handle('home:weather', (_event, location) => weatherService.weather(location));
  ipcMain.handle('home:music-library', () => musicLibrary.list());
  ipcMain.handle('home:music-mode', (_event, mode) => musicLibrary.setMode(mode));
  ipcMain.handle('home:music-select-playlist', (_event, payload) => musicLibrary.selectPlaylist(payload));
  ipcMain.handle('home:music-refresh-source', (_event, sourceId) => musicLibrary.refreshSource(sourceId));
  ipcMain.handle('home:music-add-source', (_event, payload) => musicLibrary.addCatalogSource(payload));
  ipcMain.handle('home:music-remove-source', (_event, sourceId) => musicLibrary.removeCatalogSource(sourceId));
  ipcMain.handle('home:music-browse-categories', (_event, payload) => musicLibrary.browseOnlineCategories(payload));
  ipcMain.handle('home:music-search-playlists', (_event, payload) => musicLibrary.browseOnlineSearch(payload));
  ipcMain.handle('home:music-browse-category', (_event, payload) => musicLibrary.browseOnlineCategory(payload));
  ipcMain.handle('home:music-browse-recommend', (_event, payload) => musicLibrary.browseOnlineRecommend(payload));
  ipcMain.handle('home:music-browse-user-playlists', (_event, payload) => musicLibrary.browseOnlineUserPlaylists(payload));
  ipcMain.handle('home:music-select-online-playlist', (_event, payload) => musicLibrary.browseOnlinePlaylist(payload));
  ipcMain.handle('home:music-choose-files', async () => {
    const choice = await showOwnedOpenDialog({
      title: '添加本地音乐',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'webm'] }],
    });
    if (choice.canceled || !choice.filePaths.length) return { ok: false, error: 'cancelled' };
    return musicLibrary.addLocal(choice.filePaths);
  });
  ipcMain.handle('home:music-choose-folder', async () => {
    const choice = await showOwnedOpenDialog({ title: '添加音乐文件夹', properties: ['openDirectory'] });
    if (choice.canceled || !choice.filePaths.length) return { ok: false, error: 'cancelled' };
    return musicLibrary.addFolder(choice.filePaths[0]);
  });
  ipcMain.handle('home:music-add-network', (_event, payload) => musicLibrary.addNetwork(payload));
  ipcMain.handle('home:music-remove', (_event, trackId) => musicLibrary.remove(trackId));
  ipcMain.handle('home:music-load', (_event, trackId) => musicLibrary.load(trackId));
  ipcMain.handle('home:music-cover', (_event, trackId) => musicLibrary.loadCover(trackId));
}

module.exports = { registerHomeIpc };
