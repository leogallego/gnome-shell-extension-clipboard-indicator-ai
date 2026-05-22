import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import { PrefsFields } from './constants.js';

const FileQueryInfoFlags = Gio.FileQueryInfoFlags;
const FileCopyFlags = Gio.FileCopyFlags;
const FileTest = GLib.FileTest;

export class Registry {
    constructor ({ settings, uuid }) {
        this.uuid = uuid;
        this.settings = settings;
        this.REGISTRY_FILE = 'registry.txt';
        this.REGISTRY_DIR = GLib.get_user_cache_dir() + '/' + this.uuid;
        this.REGISTRY_PATH = this.REGISTRY_DIR + '/' + this.REGISTRY_FILE;
        this.BACKUP_REGISTRY_PATH = this.REGISTRY_PATH + '~';
    }

    write (entries) {
        const registryContent = [];

        for (let entry of entries) {
            const item = {
                favorite: entry.isFavorite(),
                mimetype: entry.mimetype()
            };

            registryContent.push(item);

            if (entry.isText()) {
                item.contents = entry.getStringValue();
            }
            else if (entry.isImage()) {
                const filename = this.getEntryFilename(entry);
                item.contents = filename;
                if (entry.hasBytes()) this.writeEntryFile(entry);
            }

            if (entry.getTag()) item.tag = entry.getTag();
        }

        this.writeToFile(registryContent);
    }

    writeToFile (registry) {
        let json = JSON.stringify(registry);
        let contents = new GLib.Bytes(json);

        // Make sure dir exists
        GLib.mkdir_with_parents(this.REGISTRY_DIR, parseInt('0775', 8));

        // Write contents to file asynchronously
        let file = Gio.file_new_for_path(this.REGISTRY_PATH);
        file.replace_async(null, false, Gio.FileCreateFlags.NONE,
                            GLib.PRIORITY_DEFAULT, null, (obj, res) => {

            let stream = obj.replace_finish(res);

            stream.write_bytes_async(contents, GLib.PRIORITY_DEFAULT,
                                null, (w_obj, w_res) => {

                w_obj.write_bytes_finish(w_res);
                stream.close(null);
            });
        });
    }

    async read () {
        return new Promise(resolve => {
            if (GLib.file_test(this.REGISTRY_PATH, FileTest.EXISTS)) {
                let file = Gio.file_new_for_path(this.REGISTRY_PATH);
                let CACHE_FILE_SIZE = this.settings.get_int(PrefsFields.CACHE_FILE_SIZE);

                file.query_info_async('*', FileQueryInfoFlags.NONE,
                                      GLib.PRIORITY_DEFAULT, null, (src, res) => {
                    // Check if file size is larger than CACHE_FILE_SIZE
                    // If so, make a backup of file, and resolve with empty array
                    let file_info = src.query_info_finish(res);

                    if (file_info.get_size() >= CACHE_FILE_SIZE * 1024 * 1024) {
                        let destination = Gio.file_new_for_path(this.BACKUP_REGISTRY_PATH);

                        file.move(destination, FileCopyFlags.OVERWRITE, null, null);
                        resolve([]);
                        return;
                    }

                    file.load_contents_async(null, (obj, res) => {
                        let [success, contents] = obj.load_contents_finish(res);

                        if (success) {
                            let max_size = this.settings.get_int(PrefsFields.HISTORY_SIZE);
                            const cacheTextData = new TextDecoder().decode(contents);
                            let registry;
                            if (cacheTextData.trim().length == 0) {
                                registry = [];
                            } else {
                                registry = JSON.parse(cacheTextData);
                            }
                            const entriesPromises = registry.map(
                                jsonEntry => {
                                    return ClipboardEntry.fromJSON(jsonEntry)
                                }
                            );

                            Promise.all(entriesPromises).then(clipboardEntries => {
                                clipboardEntries = clipboardEntries
                                    .filter(entry => entry !== null);

                                let registryNoFavorite = clipboardEntries
                                    .filter(entry => !entry.isFavorite());

                                while (registryNoFavorite.length > max_size) {
                                    let oldestNoFavorite = registryNoFavorite.shift();
                                    let itemIdx = clipboardEntries.indexOf(oldestNoFavorite);
                                    clipboardEntries.splice(itemIdx,1);

                                    registryNoFavorite = clipboardEntries.filter(
                                        entry => !entry.isFavorite()
                                    );
                                }

                                resolve(clipboardEntries);
                            }).catch(e => {
                                console.error(e);
                            });
                        }
                        else {
                            console.error('Clipboard Indicator: failed to open registry file');
                        }
                    });
                });
            }
            else {
                resolve([]);
            }
        });
    }

    #entryFileExists (entry) {
        const filename = this.getEntryFilename(entry);
        return GLib.file_test(filename, FileTest.EXISTS);
    }

    async getEntryAsImage (entry) {
        if (entry.isImage() === false) return;

        if (this.#entryFileExists(entry) === false) {
            if (!entry.hasBytes()) return;
            await this.writeEntryFile(entry);
        }

        const gicon = Gio.icon_new_for_string(this.getEntryFilename(entry));
        const stIcon = new St.Icon({ gicon });
        return stIcon;
    }

    async getEntryAsTexture (entry) {
        if (entry.isImage() === false) return null;

        if (this.#entryFileExists(entry) === false) {
            if (!entry.hasBytes()) return null;
            await this.writeEntryFile(entry);
        }

        const file = Gio.file_new_for_path(this.getEntryFilename(entry));
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        return St.TextureCache.get_default().load_file_async(file, -1, -1, scaleFactor, 1.0);
    }

    getEntryFilename (entry) {
        if (entry.getFilePath()) return entry.getFilePath();
        return `${this.REGISTRY_DIR}/${entry.asBytes().hash()}`;
    }

    async writeEntryFile (entry) {
        if (this.#entryFileExists(entry)) return;

        let file = Gio.file_new_for_path(this.getEntryFilename(entry));

        return new Promise(resolve => {
            file.replace_async(null, false, Gio.FileCreateFlags.NONE,
                               GLib.PRIORITY_DEFAULT, null, (obj, res) => {

                let stream = obj.replace_finish(res);

                stream.write_bytes_async(entry.asBytes(), GLib.PRIORITY_DEFAULT,
                                         null, (w_obj, w_res) => {

                    w_obj.write_bytes_finish(w_res);
                    stream.close(null);
                    resolve();
                });
            });
        });
    }

    async deleteEntryFile (entry) {
        const file = Gio.file_new_for_path(this.getEntryFilename(entry));

        try {
            await file.delete_async(GLib.PRIORITY_DEFAULT, null);
        }
        catch (e) {
            console.error(e);
        }
    }

    cleanOrphanedFiles (referencedPaths) {
        try {
            const folder = Gio.file_new_for_path(this.REGISTRY_DIR);
            const enumerator = folder.enumerate_children(
                'standard::name', FileQueryInfoFlags.NONE, null);

            let orphanCount = 0;
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (name === this.REGISTRY_FILE || name === this.REGISTRY_FILE + '~')
                    continue;

                const filePath = `${this.REGISTRY_DIR}/${name}`;
                if (!referencedPaths.has(filePath)) {
                    const file = Gio.file_new_for_path(filePath);
                    file.delete_async(GLib.PRIORITY_LOW, null, null);
                    orphanCount++;
                }
            }

            if (orphanCount > 0) {
                console.log(`Clipboard Indicator: removed ${orphanCount} orphaned cache file(s)`);
            }
        }
        catch (e) {
            console.error('Clipboard Indicator: failed to clean orphaned files', e);
        }
    }

    clearCacheFolder() {
        try {
            const folder = Gio.file_new_for_path(this.REGISTRY_DIR);
            const enumerator = folder.enumerate_children("", 1, null);

            let file;
            while ((file = enumerator.iterate(null)[2]) != null) {
                file.delete(null);
            }
        }
        catch (e) {
            console.error(e);
        }
    }
}

export class ClipboardEntry {
    #mimetype;
    #bytes;
    #favorite;
    #filePath = null;
    #hash = null;

    static #decode (contents) {
        return Uint8Array.from(contents.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    }

    static __isText (mimetype) {
        return mimetype.startsWith('text/') ||
            mimetype === 'STRING' ||
            mimetype === 'UTF8_STRING';
    }

    static fromCachedImage (mimetype, filePath, favorite) {
        const entry = new ClipboardEntry(mimetype, null, favorite);
        entry.#filePath = filePath;
        const parts = filePath.split('/');
        entry.#hash = parts[parts.length - 1];
        return entry;
    }

    static async fromJSON (jsonEntry) {
        const mimetype = jsonEntry.mimetype || 'text/plain;charset=utf-8';
        const favorite = jsonEntry.favorite;

        if (ClipboardEntry.__isText(mimetype)) {
            const bytes = new TextEncoder().encode(jsonEntry.contents);
            const entry = new ClipboardEntry(mimetype, bytes, favorite);
            if (jsonEntry.tag) entry.setTag(jsonEntry.tag);
            return entry;
        }

        const filename = jsonEntry.contents;
        if (!GLib.file_test(filename, FileTest.EXISTS)) return null;

        const entry = ClipboardEntry.fromCachedImage(mimetype, filename, favorite);
        if (jsonEntry.tag) entry.setTag(jsonEntry.tag);
        return entry;
    }

    constructor (mimetype, bytes, favorite) {
        this.#mimetype = mimetype;
        this.#bytes = bytes;
        this.#favorite = favorite;
    }

    #encode () {
        if (this.isText()) {
            return this.getStringValue();
        }

        return [...this.#bytes]
            .map(x => x.toString(16).padStart(2, '0'))
            .join('');
    }

    getStringValue () {
        if (this.isImage()) {
            if (this.#hash) return `[Image ${this.#hash}]`;
            return `[Image ${this.asBytes().hash()}]`;
        }
        return new TextDecoder().decode(this.#bytes);
    }

    mimetype () {
        return this.#mimetype;
    }

    isFavorite () {
        return this.#favorite;
    }

    set favorite (val) {
        this.#favorite = !!val;
    }

    isText () {
        return ClipboardEntry.__isText(this.#mimetype);
    }

    isImage () {
        return this.#mimetype.startsWith('image/');
    }

    setText (text) {
        if (!this.isText()) return;
        this.#bytes = new TextEncoder().encode(text);
    }

    #tag = null;

    getTag () {
        return this.#tag;
    }

    setTag (tag) {
        this.#tag = tag || null;
    }

    asBytes () {
        return GLib.Bytes.new(this.#bytes);
    }

    hasBytes () {
        return this.#bytes !== null;
    }

    async loadBytes () {
        if (this.#bytes !== null || !this.#filePath) return;

        return new Promise((resolve, reject) => {
            const file = Gio.file_new_for_path(this.#filePath);
            file.load_contents_async(null, (obj, res) => {
                let [success, contents] = obj.load_contents_finish(res);
                if (success) {
                    this.#bytes = contents;
                    resolve();
                } else {
                    reject(new Error(`Clipboard Indicator: could not load image from ${this.#filePath}`));
                }
            });
        });
    }

    releaseBytes () {
        if (this.#filePath) this.#bytes = null;
    }

    getFilePath () {
        return this.#filePath;
    }

    equals (otherEntry) {
        return this.getStringValue() === otherEntry.getStringValue();
        // this.asBytes().equal(otherEntry.asBytes());
    }
}
