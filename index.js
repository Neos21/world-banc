const fs    = require('node:fs').promises;
const https = require('node:https');
const os    = require('node:os');
const path  = require('node:path');
const express   = require('express');
const driveList = require('drivelist');


// Environment Variables
// ================================================================================

/** トークン */ const token = process.env.WORLD_BANC_TOKEN || 'TOKEN';
/** ポート   */ const port  = process.env.WORLD_BANC_PORT  || '8888' ;
/** DDNS     */ const ddns  = process.env.WORLD_BANC_DDNS  || 'NONE' ;


// Common
// ================================================================================

/** Logger */
const logger = {
  /** Info  Log */ info : (...messages) => console.log  (`[${new Date().toISOString()}] [INFO ]`, ...messages),
  /** Warn  Log */ warn : (...messages) => console.warn (`[${new Date().toISOString()}] [WARN ]`, ...messages),
  /** Error Log */ error: (...messages) => console.error(`[${new Date().toISOString()}] [ERROR]`, ...messages)
};

/** @typedef {string} `index.html` ファイルのフルパス (`res.sendFile()` 時はフルパスが必須のため) */
const indexHtmlFilePath = path.resolve(__dirname, './index.html');

/** @typedef {boolean} Windows か否か */
const isWindows = process.platform === 'win32';

/** @typedef {string} ホスト名 */
const hostName = os.hostname();


// Express Server Router
// ================================================================================

const app = express();
app.use(express.urlencoded({ extended: true }));  // JSON For POST
app.use(express.json());  // JSON

// Login
app.post('/login', (req, res) => {
  if(req.body?.token !== token) {
    logger.info(`[/login] Invalid Token : [${req.body?.token}]`);
    return res.json({ error: 'Invalid Token' });
  }
  logger.info('[/login] Succeeded');
  return res.json({ token });
});

// Other All Paths
app.get('/*', async (req, res) => {
  const decodedPath = decodeURIComponent(req.path);
  // 未ログイン時は HTML を返す
  if(req.headers.authorization !== `Bearer ${token}`) {
    logger.info(`[${decodedPath}] Not Authorization, Return HTML File`);
    return res.sendFile(indexHtmlFilePath);
  }
  // For Windows : `/C`・`/C/HOGE` To `C:`・`C:/HOGE`
  const path = addColonToDriveLetterForWindows(decodedPath);
  // ディレクトリ配下のファイル一覧を取得する
  if(req.query?.download == null) {
    logger.info(`[${decodedPath}] [${path}] List Files`);
    return await listFiles(path, res);
  } else {
    // 対象ファイルをダウンロードする
    logger.info(`[${decodedPath}] [${path}] Download File`);
    return await downloadFile(path, res);
  }
});


// Controllers
// ================================================================================

/**
 * ディレクトリ配下のファイル一覧をレスポンスする
 * 
 * @param {string} directoryPath ディレクトリパス
 * @param {express.Response} res レスポンス
 */
async function listFiles(directoryPath = '/', res) {
  try {
    // Windows ルートディレクトリの場合のみドライブ一覧を表示するようにする
    const files = directoryPath === '/' && isWindows ? await listDrivesForWindows() : await readDir(directoryPath);
    return res.json({ files, parentPath: getParentPath(directoryPath), hostName });
  } catch(error) { logger.error(`List Files [${directoryPath}] : Error`, error); res.json({ error: `Failed To List Root Directory : ${error}` })};
}

/**
 * ファイルをダウンロードさせる
 * 
 * @param {string} filePath ファイルパス
 * @param {express.Response} res レスポンス
 */
async function downloadFile(filePath = '/', res) {
  const dirent = await fs.stat(filePath);
  if(dirent.isDirectory()) return res.json({ error: 'The Path Is A Directory, Cannot Download' });  // ディレクトリはダウンロード対象外とする
  // 通常 `res.download()` では Dotfiles がダウンロードできないため調整する
  const baseName = path.basename(filePath);
  // 先頭のピリオドをアンダースコアに変えたモノをダウンロードファイル名にする
  if(baseName.startsWith('.')) return res.download(filePath, baseName.replace((/^\./), '_'), { dotfiles: 'allow' });
  // 通常ファイルはそのままダウンロードさせる
  return res.download(filePath);
}


// Functions
// ================================================================================

/**
 * Windows の場合にドライブ一覧をルート直下のファイル一覧として取得する
 * 
 * @param {string} path ディレクトリパス
 * @return {Promise<{ files: Array<{ name: string; isDirectory: boolean; size: string; updated: string; }>; }>} ファイル一覧 (通常の `readDir()` と合わせる)
 * @throws `driveList.list()` に失敗した場合
 */
async function listDrivesForWindows() {
  const drives = await driveList.list();
  const files = drives
    .map((rawDrive) => ({
      name       : rawDrive.mountpoints[0].path.replace((/:\\$/), ''),  // `C:\` To `C`
      isDirectory: true,  // Drive Is Directory
      size       : formatToReadableByte(rawDrive.size),  // GB
      updated    : '-'
    }))
    .sort((driveA, driveB) => {  // A To Z
      if(driveA.name < driveB.name) return -1;
      if(driveA.name > driveB.name) return  1;
      return 0;
    });
  return files;
}

/**
 * ディレクトリ配下のファイル一覧を取得する
 * 
 * @param {string} path ディレクトリパス
 * @return {Promise<{ files: Array<{ name: string; isDirectory: boolean; size: string; updated: string; }>; }>} ファイル一覧
 * @throws `fs.readdir()` に失敗した場合
 */
async function readDir(directoryPath) {
  // Windows で本スクリプトがあるドライブの場合は `E:/` のように末尾スラッシュがないとルートが表示されない
  directoryPath = directoryPath.endsWith(':') ? `${directoryPath}/` : directoryPath;
  const dirents = await fs.readdir(directoryPath, { withFileTypes: true });
  const sortedFiles = dirents
    .map((dirent) => ({
      name       : dirent.name,
      isDirectory: dirent.isDirectory(),
    }))
    .sort((fileA, fileB) => {
      if(fileA.isDirectory < fileB.isDirectory) return  1;  // ディレクトリを先頭にまとめる
      if(fileA.isDirectory > fileB.isDirectory) return -1;
      if(fileA.name        < fileB.name       ) return -1;  // ファイル名順
      if(fileA.name        > fileB.name       ) return  1;
      return 0;
    });
  const files = await Promise.all(sortedFiles.map(async (file) => {
    const stat   = await fs.stat(path.resolve(directoryPath, file.name)).catch(() => ({ size: '-', mtime: null }));
    file.size    = formatToReadableByte(stat.size);
    file.updated = formatToJst(stat.mtime);
    return file;
  }));
  return files;
}

/**
 * バイト単位のファイルサイズをヒューマンリーダブルな単位に変換する (最大で TB 単位まで)
 * 
 * @param {number | '-'} byte バイト単位のファイルサイズ
 * @return {string} 単位付きのヒューマンリーダブルなファイルサイズ
 */
function formatToReadableByte(byte) {
  try {
    if(byte === '-') return '- B';
    for(const unit of ['B', 'KB', 'MB', 'GB']) {
      if(byte < 1000) return `${byte} ${unit}`;
      byte = Math.floor(byte / 1000);
    }
    return `${byte} TB`;
  }
  catch(_error) { return `${byte} B`; }
}

/**
 * Date オブジェクトを日本時間の文字列に変更する
 * 
 * @param {Date} date Date オブジェクト
 * @return {string} 日本時間の `YYYY-MM-DD HH:mm` 形式の文字列
 */
function formatToJst(date) {
  try {
    if(date == null) return '-';
    const jst = new Date(date.getTime() + ((new Date().getTimezoneOffset() + 540) * 60000));  // 時差9時間 = 540分・分からミリ秒に変換するため 60秒 * 1000ミリ秒
    return jst.getFullYear() + '-' + ('0' + (jst.getMonth() + 1)).slice(-2) + '-' + ('0' +  jst.getDate(   )).slice(-2)
                             + ' ' + ('0' +  jst.getHours(     )).slice(-2) + ':' + ('0' +  jst.getMinutes()).slice(-2);
  } catch(_error) { return '-'; }
}

/**
 * Windows の場合にパスのドライブ名部分を `/C/HOGE` から `C:/HOGE` となるように変換する
 * 
 * @param {string} directoryPath ディレクトリパス
 * @return {string} 変換後のディレクトリパス (Windows でない場合は何もしない)
 */
function addColonToDriveLetterForWindows(directoryPath) {
  return !isWindows ? directoryPath : directoryPath.replace((/^\/([A-Za-z])/), '$1:');
}

/**
 * 一階層上のディレクトリパスを取得する
 * 
 * @param {string} directoryPath ディレクトリパス
 * @return {string} 一階層上のディレクトリパスを取得する
 */
function getParentPath(directoryPath) {
  if(directoryPath === '/') return directoryPath;  // 既にルート階層にいる場合はルート階層自体を返す
  if(isWindows && directoryPath.endsWith(':') || directoryPath.endsWith(':/')) return '/';  // Windows の場合、`C:` (念のため `C:/` も) にいる場合はルート階層を直接示してしまう
  const parentPath = path.resolve(directoryPath, '../');  // `node:path` モジュールでフルパスを取得する
  if(!isWindows) return parentPath;  // Windows でなければそのまま返して良い
  // Windows の場合、先頭に `/` を付け絶対リンクにし、`\` を `/` に全て直し、ドライブレターのみの場合は `C:` から `C` となるように直し、`C:/HOGE` は `C/HOGE` と直す
  return '/' + parentPath.replace((/\\/g), '/').replace((/:\/$/), '').replace(':/', '/');
}


// Launch Server
// ================================================================================

/**
 * ローカル IPv4 アドレスを取得する
 * 
 * @return {string} ローカル IPv4 アドレス
 */
function getLocalIp() {
  const networkInterfaces = os.networkInterfaces();
  const ethernetName = Object.keys(networkInterfaces).find((name) => ['en0', 'イーサネット'].includes(name));
  const ipv4 = networkInterfaces[ethernetName]?.find((value) => value.family === 'IPv4');
  return ipv4?.address ?? 'UNKNOWN';
}

/**
 * グローバル IPv4 アドレスを取得する
 * 
 * @return {Promise<string>} グローバル IPv4 アドレス
 */
async function getGlobalIp() {
  try {
    const rawResponseText = await new Promise((resolve, reject) => {
      const request = https.request('https://ifconfig.me/ip', {}, (response) => {
        let data = '';
        response.setEncoding('utf8')
          .on('data', (chunk) => { data += chunk; })
          .on('end' , (     ) => { resolve(data); });
      })
        .on('timeout', (     ) => { request.destroy(); reject('Timeout'); })
        .on('error'  , (error) => { reject(error); })
        .setTimeout(5000)
        .end();
    });
    return rawResponseText.replace((/[\r\n]/g), '') || 'UNKNOWN';
  } catch(error) { logger.warn('Get Global IP : Error', error); return 'ERROR'; }
}

// Launch
(async () => {
  logger.info('Settings :');
  const localIp  = getLocalIp();
  const globalIp = await getGlobalIp();
  const maxLength = Math.max(...['WORLD_BANC_TOKEN', localIp, globalIp, ddns].map((value) => value.length));
  logger.info(`  OS        [${process.platform}]`);
  logger.info(`  Token     [${'WORLD_BANC_TOKEN'.padEnd(maxLength, ' ')}] : [${token}]`);
  logger.info(`  Port      [${'WORLD_BANC_PORT' .padEnd(maxLength, ' ')}] : [${port }]`);
  logger.info(`  Local IP  [${localIp           .padEnd(maxLength, ' ')}] : http://${localIp }:${port}/`);
  logger.info(`  Global IP [${globalIp          .padEnd(maxLength, ' ')}] : http://${globalIp}:${port}/`);
  logger.info(`  DDNS      [${'WORLD_BANC_DDNS' .padEnd(maxLength, ' ')}] : http://${ddns    }:${port}/`);
  app.listen(port, () => logger.info(`Server Started`));
})();
