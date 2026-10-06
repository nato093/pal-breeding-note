// ドロップで受け取るファイルのハンドル（FileSystemFileHandle）と、IndexedDB の保存先の代わり。

export const T0 = Date.parse('2026-10-05T01:00:00.000Z');

/**
 * ファイルのハンドル。permission・time・size・gone（ファイルが消えた）・error（getFile の失敗の名前）・
 * readError（中身を読むときの失敗の名前）・gate（読み込みを止める Promise）を変えて使う。
 */
export function fakeHandle(name, { time = T0, size = 1, permission = 'granted' } = {}) {
  return {
    kind: 'file', name, time, size, permission, gone: false, error: '', readError: '', gate: null, requests: 0,
    async queryPermission() { return this.permission; },
    async requestPermission() { this.requests++; if (this.permission !== 'denied') this.permission = 'granted'; return this.permission; },
    async getFile() {
      if (this.permission !== 'granted') throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
      if (this.gone) throw Object.assign(new Error('gone'), { name: 'NotFoundError' });
      if (this.error) throw Object.assign(new Error(this.error), { name: this.error });
      const { gate, readError } = this;
      return {
        lastModified: this.time, size: this.size,
        arrayBuffer: async () => {
          if (gate) await gate;
          if (readError) throw Object.assign(new Error(readError), { name: readError });
          return new Uint8Array([name.length]).buffer;
        },
      };
    },
  };
}

/** ホストのワールドのファイル一式（Level.sav と LocalData.sav は同じ時刻に保存されたもの）。 */
export function hostFiles(time = T0, { players = ['00000000000000000000000000000001'] } = {}) {
  const files = {
    'Level.sav': fakeHandle('Level.sav', { time }),
    'LevelMeta.sav': fakeHandle('LevelMeta.sav', { time }),
    'LocalData.sav': fakeHandle('LocalData.sav', { time: time + 500 }),
  };
  for (const id of players) files[`Players/${id}.sav`] = fakeHandle(`${id}.sav`, { time });
  return files;
}

export const asDropped = (files) => Object.entries(files).map(([path, handle]) => ({ path, name: handle.name, handle }));

/** idbPersist と同じ形の保存先。strict を false にすると、setStrict・removeStrict が失敗する（保存できないブラウザ）。 */
export function memoryPersist() {
  const map = new Map();
  const persist = {
    map, strict: true,
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
    async setStrict(key, value) { if (!persist.strict) throw new Error('保存できません'); map.set(key, value); },
    async removeStrict(key) { if (!persist.strict) throw new Error('保存できません'); map.delete(key); },
  };
  return persist;
}
