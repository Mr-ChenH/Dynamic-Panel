'use strict';

function createJsonFileStore({ fsModule, pathModule, processId } = {}) {
  if (!fsModule || !pathModule) throw new TypeError('fsModule and pathModule are required');
  const temporarySuffix = processId === undefined ? process.pid : processId;

  function readJsonFile(filePath, fallback = {}) {
    try {
      const parsed = JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJsonFile(filePath, value) {
    const temporaryPath = `${filePath}.${temporarySuffix}.tmp`;
    try {
      fsModule.mkdirSync(pathModule.dirname(filePath), { recursive: true });
      fsModule.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
      fsModule.renameSync(temporaryPath, filePath);
      return true;
    } catch (error) {
      try { fsModule.unlinkSync(temporaryPath); } catch (unlinkError) {}
      return false;
    }
  }

  return { readJsonFile, writeJsonFile };
}

module.exports = { createJsonFileStore };
