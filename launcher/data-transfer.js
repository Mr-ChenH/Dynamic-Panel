'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const LIMIT = 20 * 1024 * 1024;
function safeName(name) {
  return typeof name === 'string' && name.length <= 240 && name.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f<>"|?*]/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
async function exportData(directory, extensionId) {
  const files = []; let bytes = 0;
  async function walk(current, prefix = '', depth = 0) {
    if (depth > 12) throw Error('extension_data_too_large');
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw Error('extension_symlink');
    if (!stat.isDirectory()) throw Error('invalid_extension_data');
    for (const entry of await fs.readdir(current, {withFileTypes:true})) {
      const relative = prefix + entry.name, full = path.join(current, entry.name);
      if (!safeName(relative)) throw Error('invalid_extension_data');
      const info = await fs.lstat(full);
      if (info.isSymbolicLink()) throw Error('extension_symlink');
      if (info.isDirectory()) await walk(full, relative+'/', depth+1);
      else if (info.isFile()) {
        bytes += info.size;
        if (bytes > LIMIT || files.length >= 500) throw Error('extension_data_too_large');
        const data = await fs.readFile(full);
        if (data.length !== info.size) throw Error('extension_data_changed');
        files.push({path:relative, data:data.toString('base64')});
      } else throw Error('invalid_extension_data');
    }
  }
  try { await fs.lstat(directory); } catch (error) { if (error.code === 'ENOENT') return {schemaVersion:1, extensionId, files:[]}; throw error; }
  await walk(directory);
  return {schemaVersion:1, extensionId, files};
}
function validateArchive(value, extensionId) {
  if (!value || value.schemaVersion !== 1 || value.extensionId !== extensionId || !Array.isArray(value.files) || value.files.length > 500) throw Error('invalid_extension_data');
  let bytes=0; const seen = new Set();
  return value.files.map(file => {
    if (!file || !safeName(file.path) || file.path.split('/').length > 13 || typeof file.data !== 'string' || file.data.length > Math.ceil(LIMIT/3)*4 || (file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))) throw Error('invalid_extension_data');
    const name = file.path.toLowerCase();
    if (seen.has(name)) throw Error('invalid_extension_data');
    seen.add(name);
    const data=Buffer.from(file.data,'base64'); if(data.toString('base64')!==file.data)throw Error('invalid_extension_data'); bytes+=data.length;
    if(bytes>LIMIT)throw Error('extension_data_too_large');
    return {path:file.path,data};
  });
}
async function importData(directory, extensionId, archive) {
  const files=validateArchive(archive,extensionId);
  await fs.mkdir(path.dirname(directory),{recursive:true});
  const stage=directory+'.stage-'+crypto.randomUUID(), backup=directory+'.backup-'+crypto.randomUUID();
  let backedUp=false, installed=false;
  try {
    await fs.mkdir(stage);
    for(const file of files){const target=path.join(stage,...file.path.split('/'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.data,{flag:'wx'});}
    try {const stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('invalid_extension_data');await fs.rename(directory,backup);backedUp=true;} catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.rename(stage,directory);installed=true;
  } catch(error){if(backedUp&&!installed)await fs.rename(backup,directory);throw error;}
  finally{await fs.rm(stage,{recursive:true,force:true});}
  // A cleanup failure must not report a successfully installed archive as failed.
  if(backedUp)await fs.rm(backup,{recursive:true,force:true}).catch(()=>{});
}
module.exports={exportData,importData,validateArchive};
