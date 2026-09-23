const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', process.env.TODO_TEST_USER_DATA);

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1440,
    height: 800,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  const errors = [];
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const state = await window.webContents.executeJavaScript(`(async () => {
      const navigation = document.querySelector('[data-settings-category="sync"]');
      navigation?.click();
      const inventory = await window.NotchSyncRuntime.inventory();
      const panel = document.getElementById('sync-settings');
      const syncView = window.NotchSyncView.createView(document);
      syncView.renderPreview({ok:true,planId:'plan-1',recommended:'merge',categories:{todo:true,notes:true,clipboard:true},local:{totalRecords:2,totalBytes:2048,categories:{todo:{records:1,bytes:512},notes:{records:1,bytes:1536}}},remote:{todo:{records:1,bytes:256},clipboard:{records:3,bytes:1024}}});
      syncView.renderConflicts({items:[{conflictId:'conflict-1',entityType:'note',entityId:'note-1',currentPayload:{title:'Current',body:'a'},incomingPayload:{title:'Incoming',body:'b'},currentOriginClientId:'client-current',incomingOriginClientId:'client-incoming',changedFields:['body'],createdAt:'2026-01-01T00:00:00.000Z'}]});
      const conflictRow = document.querySelector('.sync-conflict-row');
      const modeValues = [...document.getElementById('sync-first-sync-mode').options].map((option) => option.value);
      return {
        runtime: Boolean(window.NotchSyncRuntime),
        controller: Boolean(window.NotchSyncController),
        projection: Boolean(window.NotchSyncProjection),
        navigation: Boolean(navigation),
        navigationSelected: navigation?.getAttribute('aria-selected'),
        panelConnected: panel?.isConnected,
        panelHidden: panel?.hidden,
        firstSyncModes: modeValues,
        categorySwitches: document.querySelectorAll('[data-sync-category]').length,
        impactRows: document.querySelectorAll('.sync-first-sync-impact > div').length,
        impactText: document.getElementById('sync-first-sync-summary')?.textContent,
        conflictActions: conflictRow?.querySelectorAll('button').length,
        conflictDetail: conflictRow?.textContent,
        inventoryRecords: inventory.records.length,
        inventoryTotal: inventory.totalRecords,
      };
    })()`);
    assert.deepEqual(errors, [], 'Sync renderer must initialize without console errors');
    assert.equal(state.runtime, true);
    assert.equal(state.controller, true);
    assert.equal(state.projection, true);
    assert.equal(state.navigation, true);
    assert.equal(state.navigationSelected, 'true');
    assert.equal(state.panelConnected, true);
    assert.equal(state.panelHidden, false);
    assert.deepEqual(state.firstSyncModes, ['merge', 'upload', 'download', 'local-wins', 'server-wins']);
    assert.equal(state.categorySwitches, 11);
    assert.equal(state.impactRows, 3);
    assert.match(state.impactText, /2\.0 KB/);
    assert.equal(state.conflictActions, 3);
    assert.match(state.conflictDetail, /来源 client-curre \/ client-incom/);
    assert.match(state.conflictDetail, /差异 body/);
    assert.equal(state.inventoryRecords, state.inventoryTotal);
    console.log('Sync renderer runtime and settings workflow checks passed');
  } finally {
    window.destroy();
  }
}

main().then(() => app.quit(), (error) => {
  console.error(error);
  app.exit(1);
});
