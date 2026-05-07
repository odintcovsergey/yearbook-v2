// build_tryumo.jsx  v3.0
// Автовёрстка Фотопапки «Трюмо» для Adobe InDesign (ExtendScript ES3/ES5)
//
// Лицевой разворот (T/Front) — ОДНА широкая страница на каждого ученика.
//   Все ученики верстаются в текущий документ постранично.
//
// Внутренний разворот (T/Inner-14..32) — одна страница на весь класс.
//
// Поиск фото: выбирается корневая папка проекта,
// скрипт рекурсивно индексирует все вложенные файлы (как в build_album).

// ═══════════════════════════════════════════════════════════
// ИНДЕКС ИЗОБРАЖЕНИЙ — идентичен build_album
// ═══════════════════════════════════════════════════════════
function buildImageIndex(rootFolder) {
    var exact = {}, canon = {}, canonDupes = {}, duplicates = [], count = 0;
    var extensions = { "jpg":1,"jpeg":1,"png":1,"tif":1,"tiff":1,"psd":1 };

    function canonKey(s) {
        var k = s.toLowerCase();
        var nfc = "";
        for (var ni = 0; ni < k.length; ni++) {
            var ch = k.charAt(ni);
            var code = k.charCodeAt(ni);
            var next = ni+1 < k.length ? k.charCodeAt(ni+1) : 0;
            if (code === 0x438 && next === 0x306) { nfc += "\u0439"; ni++; continue; }
            if (code === 0x418 && next === 0x306) { nfc += "\u0419"; ni++; continue; }
            if (code === 0x435 && next === 0x308) { nfc += "\u0451"; ni++; continue; }
            if (code === 0x415 && next === 0x308) { nfc += "\u0401"; ni++; continue; }
            nfc += ch;
        }
        k = nfc;
        var clean = "", i2 = 0;
        while (i2 < k.length) {
            var c2 = k.charAt(i2);
            if (c2 === "(") {
                var j = i2+1; while (j < k.length && k.charAt(j) !== ")") j++;
                i2 = j+1; continue;
            }
            clean += c2; i2++;
        }
        var r = "";
        for (var ci = 0; ci < clean.length; ci++) {
            var cd = clean.charCodeAt(ci);
            if ((cd >= 97 && cd <= 122)||(cd >= 0x430 && cd <= 0x44F)||
                (cd >= 0x410 && cd <= 0x42F)||cd===0x451||cd===0x401||cd===46)
                r += clean.charAt(ci);
        }
        return r;
    }
    function nfc(s) {
        var r = "";
        for (var ni = 0; ni < s.length; ni++) {
            var code = s.charCodeAt(ni), next = ni+1<s.length?s.charCodeAt(ni+1):0;
            if (code===0x438&&next===0x306){r+="\u0439";ni++;continue;}
            if (code===0x418&&next===0x306){r+="\u0419";ni++;continue;}
            if (code===0x435&&next===0x308){r+="\u0451";ni++;continue;}
            if (code===0x415&&next===0x308){r+="\u0401";ni++;continue;}
            r+=s.charAt(ni);
        }
        return r;
    }
    function scan(folder) {
        var files = folder.getFiles();
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f instanceof Folder) { scan(f); continue; }
            var fname = f.displayName || f.name;
            try { fname = decodeURI(fname); } catch(e) {}
            fname = nfc(fname);
            var dot = fname.lastIndexOf(".");
            if (dot < 0) continue;
            if (!extensions[fname.substring(dot+1).toLowerCase()]) continue;
            var eKey = fname.toLowerCase();
            if (!exact[eKey]) { exact[eKey] = f; count++; } else { duplicates.push(fname); }
            var cKey = canonKey(fname);
            if (canon[cKey] && canon[cKey].fsName !== f.fsName) canonDupes[cKey] = 1;
            else canon[cKey] = f;
        }
    }
    if (rootFolder && rootFolder.exists) scan(rootFolder);
    return { exact:exact, canon:canon, canonDupes:canonDupes, canonKey:canonKey,
             count:count, duplicates:duplicates };
}

function findInIndex(idx, filename) {
    if (!filename) return null;
    var eKey = filename.toLowerCase();
    if (idx.exact[eKey]) return { file: idx.exact[eKey], fuzzy: false };
    var cKey = idx.canonKey(filename);
    if (idx.canon[cKey] && !idx.canonDupes[cKey]) return { file: idx.canon[cKey], fuzzy: true };
    return null;
}

// ═══════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════
function findMaster(doc, prefix, baseName) {
    var lbn = baseName.toLowerCase();
    for (var m = 0; m < doc.masterSpreads.length; m++) {
        var ms = doc.masterSpreads[m];
        if (ms.namePrefix === prefix && ms.baseName.toLowerCase() === lbn) return ms;
    }
    return null;
}

function overrideMaster(page) {
    try {
        var mi = page.masterPageItems;
        for (var i = 0; i < mi.length; i++) { try { mi[i].override(page); } catch(e) {} }
    } catch(e) {}
}

function clearOverrides(page) {
    try {
        var arr = [];
        var live = page.allPageItems;
        for (var i = 0; i < live.length; i++) {
            try { void live[i].label; arr.push(live[i]); } catch(e) {}
        }
        for (var j = 0; j < arr.length; j++) { try { arr[j].remove(); } catch(e) {} }
    } catch(e) {}
}

function getByLabel(page) {
    var map = {};
    try {
        var live = page.allPageItems;
        for (var i = 0; i < live.length; i++) {
            var lb; try { lb = live[i].label; } catch(e) { continue; }
            if (lb && lb !== "" && !map[lb]) map[lb] = live[i];
        }
    } catch(e) {}
    return map;
}

function placeImage(frame, file) {
    try {
        frame.place(file);
        frame.fit(FitOptions.FILL_PROPORTIONALLY);
        frame.fit(FitOptions.CENTER_CONTENT);
        return true;
    } catch(e) { return false; }
}

function fillText(frame, text) {
    if (!frame || !text) return;
    try { frame.contents = String(text); } catch(e) {}
}

function padNum(n, w) {
    var s = "" + n; while (s.length < w) s = "0" + s; return s;
}

function saveReport(folder, filename, lines) {
    var f = new File(folder + "/" + filename);
    f.encoding = "UTF-8"; f.lineFeed = "Windows"; f.open("w");
    for (var i = 0; i < lines.length; i++) f.writeln(lines[i]);
    f.close();
}

function getSortedImages(folder) {
    var imgs = [];
    if (!folder || !folder.exists) return imgs;
    var files = folder.getFiles();
    var exts = { "jpg":1,"jpeg":1,"png":1,"tif":1,"tiff":1 };
    for (var i = 0; i < files.length; i++) {
        if (!(files[i] instanceof File)) continue;
        var ext = files[i].name.replace(/.*\./,"").toLowerCase();
        if (exts[ext]) imgs.push(files[i]);
    }
    imgs.sort(function(a,b) {
        // Декодируем для сортировки
        var na = a.name.toLowerCase(), nb = b.name.toLowerCase();
        try { na = decodeURIComponent(na); } catch(e) {}
        try { nb = decodeURIComponent(nb); } catch(e) {}
        return na < nb ? -1 : na > nb ? 1 : 0;
    });
    return imgs;
}

// ═══════════════════════════════════════════════════════════
// РАЗБОР CSV (совместим с форматом build_album)
// ═══════════════════════════════════════════════════════════
function parseCSVLine(line) {
    var fields = [], cur = "", inQ = false;
    for (var i = 0; i <= line.length; i++) {
        var ch = i < line.length ? line.charAt(i) : null;
        if (inQ) {
            if (ch === '"') {
                if (i+1 < line.length && line.charAt(i+1) === '"') { cur += '"'; i++; }
                else { inQ = false; }
            } else if (ch === null) { fields.push(cur); cur = ""; }
            else { cur += ch; }
        } else {
            if (ch === '"') { inQ = true; }
            else if (ch === "," || ch === null) { fields.push(cur.replace(/^\s+|\s+$/g,"")); cur = ""; }
            else { cur += ch; }
        }
    }
    return fields;
}

function parseCSV(path) {
    var result = { meta:{city:"",school:"",year:""}, students:[], teachers:[] };
    var f = new File(path); f.encoding = "UTF-8";
    if (!f.open("r")) { alert("Не удалось открыть CSV:\n" + path); return result; }
    var content = f.read(); f.close();
    content = content.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
    var lines = content.split("\n");
    var headers = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/^\s+|\s+$/g,"");
        if (!line) continue;
        var flds = parseCSVLine(line);
        if (!flds.length) continue;
        var tag = flds[0].toUpperCase();
        if (tag === "META") {
            result.meta = { city:flds[1]||"", school:flds[2]||"", year:flds[3]||"" };
            continue;
        }
        if (!headers) {
            headers = [];
            for (var h = 0; h < flds.length; h++)
                headers.push(flds[h].toLowerCase().replace(/\s+/g,"_"));
            continue;
        }
        var row = {};
        for (var c = 0; c < headers.length; c++)
            row[headers[c]] = c < flds.length ? flds[c] : "";
        if (tag === "УЧИТЕЛЬ") {
            result.teachers.push({ name:row["ученик"]||"", photo:row["портрет_страница"]||"",
                                   role:row["обложка"]||"", text:row["текст"]||"" });
        } else if (row["ученик"]) {
            var friends = [];
            for (var fi = 1; fi <= 20; fi++) { var fv = row["фото_друзья_"+fi]||""; if (fv) friends.push(fv); }
            result.students.push({ className:row["класс"]||"", name:row["ученик"]||"",
                portraitPage:row["портрет_страница"]||"", cover:row["обложка"]||"",
                portraitCover:row["портрет_обложка"]||"", text:row["текст"]||"", friends:friends });
        }
    }
    return result;
}

// ═══════════════════════════════════════════════════════════
// ВЫБОР МАСТЕРА ВНУТРЕННЕГО ПО ЧИСЛУ УЧЕНИКОВ
// ═══════════════════════════════════════════════════════════
function pickInnerMaster(doc, count) {
    var sizes = [14, 18, 24, 28, 32];
    for (var i = 0; i < sizes.length; i++) {
        if (count <= sizes[i]) {
            var m = findMaster(doc, "T", "Inner-" + sizes[i]);
            if (m) return { master:m, size:sizes[i] };
        }
    }
    var m32 = findMaster(doc, "T", "Inner-32");
    return { master:m32, size:32 };
}

// ═══════════════════════════════════════════════════════════
// ЗАПОЛНЕНИЕ СТРАНИЦЫ ЛИЦЕВОГО РАЗВОРОТА
// ═══════════════════════════════════════════════════════════
function fillFrontPage(page, master, student, halfImgs, fullImgs, idx, meta, className, report) {
    clearOverrides(page);
    try { page.appliedMaster = master; } catch(e) {}
    overrideMaster(page);
    var lbl = getByLabel(page);

    // Вставка из File-объекта напрямую (без индекса — имена common-файлов URL-кодированы)
    function putFile(key, fileObj) {
        if (!lbl[key] || !fileObj) return;
        placeImage(lbl[key], fileObj);
    }
    // Вставка портрета через индекс (имя берём из CSV, файл ищем в папке)
    function putIdx(key, filename) {
        if (!lbl[key]) return;
        var found = findInIndex(idx, filename);
        if (found) { placeImage(lbl[key], found.file); }
        else if (filename) report.push("[WARN] " + student.name + " | " + key + ": не найдено (" + filename + ")");
    }

    // Фото полкласса и общие — передаём File-объект напрямую
    putFile("halfPhoto_1", halfImgs[0] || null);
    putFile("halfPhoto_2", halfImgs[1] || null);
    putFile("fullPhoto_1", fullImgs[0] || null);
    putFile("fullPhoto_2", fullImgs[1] || null);
    // Портрет ученика — через индекс
    putIdx("portraitFrame", student.portraitPage);
    // Текстовые поля
    if (lbl["studentName"])  fillText(lbl["studentName"],  student.name);
    if (lbl["yearFrame"])    fillText(lbl["yearFrame"],    meta.year   || "");
    if (lbl["schoolFrame"])  fillText(lbl["schoolFrame"],  meta.school || "");
    if (lbl["classFrame"])   fillText(lbl["classFrame"],   className   || "");
}

// ═══════════════════════════════════════════════════════════
// ЗАПОЛНЕНИЕ СТРАНИЦЫ ВНУТРЕННЕГО РАЗВОРОТА
// ═══════════════════════════════════════════════════════════
function fillInnerPage(page, master, data, idx, masterSize, report) {
    var students = data.students;
    var teacher  = data.teachers.length > 0 ? data.teachers[0] : null;

    clearOverrides(page);
    try { page.appliedMaster = master; } catch(e) {}
    overrideMaster(page);
    var lbl = getByLabel(page);

    // Классрук
    if (teacher) {
        var found = findInIndex(idx, teacher.photo);
        if (lbl["headTeacherPhoto"] && found) placeImage(lbl["headTeacherPhoto"], found.file);
        else report.push("[WARN] Inner | headTeacherPhoto: не найдено (" + teacher.photo + ")");
        if (lbl["headTeacherName"]) fillText(lbl["headTeacherName"], teacher.name);
        if (lbl["headTeacherRole"]) fillText(lbl["headTeacherRole"], teacher.role);
        if (lbl["headTextFrame"])   fillText(lbl["headTextFrame"],   teacher.text);
        report.push("[OK]   Inner | Классрук: " + teacher.name);
    } else { report.push("[WARN] Inner | Учитель не задан в CSV"); }

    // Сетка учеников
    var filled = 0;
    for (var si = 0; si < students.length; si++) {
        var sn = si + 1;
        var sp = findInIndex(idx, students[si].portraitPage);
        if (lbl["studentPhoto_"+sn]) {
            if (sp) { placeImage(lbl["studentPhoto_"+sn], sp.file); filled++; }
            else report.push("[WARN] Inner | studentPhoto_"+sn+": нет фото ("+students[si].name+")");
        }
        if (lbl["studentName_"+sn]) fillText(lbl["studentName_"+sn], students[si].name);
    }

    // Скрываем незаполненные слоты (слоты > числа учеников)
    var slot = students.length + 1;
    while (true) {
        var pFrame = lbl["studentPhoto_" + slot];
        var nFrame = lbl["studentName_"  + slot];
        if (!pFrame && !nFrame) break; // больше слотов нет
        if (pFrame) { try { pFrame.visible = false; } catch(e) {} }
        if (nFrame) { try { nFrame.visible = false; } catch(e) {} }
        slot++;
    }

    report.push("[OK]   Inner-" + masterSize + " | Сетка: " + filled + "/" + students.length);
}

// ═══════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════════════════
function main() {
    var CRLF = "\r\n";

    // Шаг 1: режим
    var modeDlg = new Window("dialog", "OkeyBook — Трюмо");
    modeDlg.orientation = "column"; modeDlg.margins = 20; modeDlg.spacing = 12;
    modeDlg.preferredSize.width = 360;
    modeDlg.add("statictext", undefined, "Что верстать?");
    var rb1 = modeDlg.add("radiobutton", undefined, "Лицевые развороты (все ученики в текущий документ)");
    var rb2 = modeDlg.add("radiobutton", undefined, "Внутренний разворот (один на класс)");
    rb1.value = true;
    var gB0 = modeDlg.add("group"); gB0.alignment = "right";
    gB0.add("button", undefined, "Далее →", { name:"ok" });
    gB0.add("button", undefined, "Отмена",  { name:"cancel" });
    if (modeDlg.show() !== 1) return;
    var modeFront = rb1.value;

    if (app.documents.length === 0) {
        alert("Откройте шаблон Трюмо в InDesign до запуска скрипта."); return;
    }
    var docNames = [];
    for (var di = 0; di < app.documents.length; di++) docNames.push(app.documents[di].name);

    // Шаг 2: документ
    var docDlg = new Window("dialog", "OkeyBook — Трюмо");
    docDlg.orientation = "column"; docDlg.margins = 16; docDlg.spacing = 8;
    docDlg.preferredSize.width = 420;
    docDlg.add("statictext", undefined, modeFront
        ? "Документ лицевого разворота:" : "Документ внутреннего разворота:");
    var gDoc = docDlg.add("group");
    var ddDoc = gDoc.add("dropdownlist", [0,0,380,24], docNames);
    ddDoc.selection = 0;
    var gB1 = docDlg.add("group"); gB1.alignment = "right";
    gB1.add("button", undefined, "Далее →", { name:"ok" });
    gB1.add("button", undefined, "Отмена",  { name:"cancel" });
    if (docDlg.show() !== 1) return;
    var activeDoc = app.documents[ddDoc.selection.index];

    // Шаг 3: CSV
    var csvFile = File.openDialog("CSV файл проекта", "*.csv,*.CSV");
    if (!csvFile) return;

    // Шаг 4: корневая папка проекта (как в build_album)
    var photoFolder = Folder.selectDialog("Корневая папка проекта (как при верстке альбома)");
    if (!photoFolder) return;

    // Шаг 5: папка для отчёта
    var outFolder = Folder.selectDialog("Папка для сохранения отчёта");
    if (!outFolder) outFolder = photoFolder;

    // Разбор CSV
    var data = parseCSV(csvFile.fsName);
    if (!data.students.length) { alert("В CSV не найдено учеников."); return; }

    var meta = data.meta;
    var className = data.students.length > 0 ? data.students[0].className : "";

    // Индекс всех изображений (рекурсивно, как в build_album)
    var idx = buildImageIndex(photoFolder);

    var report = [];
    var errCount = 0, warnCount = 0;
    report.push("=== АВТОВЁРСТКА ТРЮМО — " + (modeFront ? "ЛИЦЕВЫЕ" : "ВНУТРЕННИЙ") + " ===");
    report.push("CSV: " + csvFile.fsName);
    report.push("Папка: " + photoFolder.fsName);
    report.push("Изображений найдено: " + idx.count);
    report.push("Учеников: " + data.students.length);
    report.push("");

    app.scriptPreferences.enableRedraw = false;

    if (modeFront) {
        // ════ ЛИЦЕВЫЕ ════
        var masterFront = findMaster(activeDoc, "T", "Front");
        if (!masterFront) {
            alert("Мастер T/Front не найден в документе " + activeDoc.name); return;
        }

        // Фото полкласса и общие
        var halfImgs = getSortedImages(new Folder(photoFolder.fsName + "/common/half"));
        var fullImgs = getSortedImages(new Folder(photoFolder.fsName + "/common/class_full"));
        report.push("Фото полкласса: " + halfImgs.length + "/2");
        report.push("Общих фото: "     + fullImgs.length + "/2");
        report.push("─── ЛИЦЕВЫЕ (" + data.students.length + " шт.) ───");

        // Удаляем все страницы кроме первой, добавляем нужное количество
        while (activeDoc.pages.length > 1) activeDoc.pages[activeDoc.pages.length-1].remove();
        while (activeDoc.pages.length < data.students.length)
            activeDoc.pages.add(LocationOptions.AT_END);

        for (var si = 0; si < data.students.length; si++) {
            var st = data.students[si];
            var page = activeDoc.pages[si];
            fillFrontPage(page, masterFront, st, halfImgs, fullImgs, idx, meta, className, report);
            report.push("[OK]   " + padNum(si+1,3) + " | " + st.name);
        }

        app.scriptPreferences.enableRedraw = true;
        for (var ri = 0; ri < report.length; ri++) {
            if (report[ri].indexOf("[WARN]") >= 0) warnCount++;
        }
        report.push(""); report.push("Ошибок: " + errCount + "  |  Предупреждений: " + warnCount);
        saveReport(outFolder.fsName, "tryumo_front_report.txt", report);
        alert("ЛИЦЕВЫЕ ГОТОВЫ!" + CRLF + CRLF +
              "Страниц в документе: " + data.students.length + CRLF +
              "Ошибок: " + errCount + "  Предупреждений: " + warnCount + CRLF +
              "Сохраните документ вручную (Cmd+S / Ctrl+S)");

    } else {
        // ════ ВНУТРЕННИЙ ════
        var masterInfo = pickInnerMaster(activeDoc, data.students.length);
        if (!masterInfo.master) {
            alert("Не найден мастер T/Inner-* в документе " + activeDoc.name + CRLF +
                  "Создайте: T/Inner-14, T/Inner-18, T/Inner-24, T/Inner-28, T/Inner-32");
            return;
        }
        report.push("Мастер: T/Inner-" + masterInfo.size);
        if (data.students.length > masterInfo.size)
            report.push("[WARN] Учеников (" + data.students.length + ") > слотов (" + masterInfo.size + ")");

        while (activeDoc.pages.length > 1) activeDoc.pages[activeDoc.pages.length-1].remove();

        fillInnerPage(activeDoc.pages[0], masterInfo.master, data, idx, masterInfo.size, report);

        app.scriptPreferences.enableRedraw = true;
        for (var ri2 = 0; ri2 < report.length; ri2++) {
            if (report[ri2].indexOf("[WARN]") >= 0) warnCount++;
        }
        report.push(""); report.push("Ошибок: " + errCount + "  |  Предупреждений: " + warnCount);
        saveReport(outFolder.fsName, "tryumo_inner_report.txt", report);
        alert("ВНУТРЕННИЙ ГОТОВ!" + CRLF + CRLF +
              "Мастер: T/Inner-" + masterInfo.size + CRLF +
              "Учеников: " + data.students.length + CRLF +
              "Ошибок: " + errCount + "  Предупреждений: " + warnCount + CRLF +
              "Сохраните документ вручную (Cmd+S / Ctrl+S)");
    }
}

main();
