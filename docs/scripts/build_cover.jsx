// ========================================================
// АВТОВЁРСТКА ОБЛОЖКИ v1.0
// Отдельный скрипт для сборки обложки альбома.
//
// Три варианта обложки (выбирается в диалоге):
//   1. A-Cover-Portrait  — портрет ученика + ФИО + метаданные
//   2. A-Cover-ClassPhoto — общее фото класса + метаданные
//   3. A-Cover-NoPhoto   — только метаданные, без фото
//
// Метаданные (город, школа, год, класс) берутся из data.csv
// через строку META в начале файла.
//
// Портрет для варианта 1:
//   - coverMode="same"  → берём Портрет_страница
//   - coverMode="other" → берём Портрет_обложка
//   - coverMode="none"  → фото не ставим (предупреждение)
//   Ученика выбирает оператор в диалоге.
//
// Общее фото для варианта 2:
//   Оператор выбирает файл вручную через диалог.
// ========================================================

#target indesign

function main() {
    if (app.documents.length === 0) {
        alert("Откройте документ обложки и запустите снова.");
        return;
    }

    var doc = app.activeDocument;
    var CRLF = String.fromCharCode(13) + String.fromCharCode(10);

    // --- Проверяем мастера ---
    var masterPortrait = findMaster(doc, "A", "Cover-Portrait");
    var masterNoPhoto  = findMaster(doc, "A", "Cover-NoPhoto");

    var missing = [];
    if (!masterPortrait) missing.push("A-Cover-Portrait");
    if (!masterNoPhoto)  missing.push("A-Cover-NoPhoto");
    if (missing.length > 0) {
        alert("Не найдены мастера:" + CRLF + missing.join(CRLF));
        return;
    }

    // --- Выбор CSV ---
    var csvFile = File.openDialog("Выберите data.csv из папки проекта", "*.csv");
    if (!csvFile) return;

    var parsed = parseCSV(csvFile.fsName);
    if (parsed.errors.length > 0) {
        alert("Ошибки CSV:" + CRLF + parsed.errors.join(CRLF));
        return;
    }

    var meta = parsed.meta;

    // --- Выбор папки с фото ---
    var photoFolder = Folder.selectDialog(
        "Выберите папку с фото",
        csvFile.parent
    );
    if (!photoFolder) return;

    // --- Анализируем CSV ---
    // Ученики с same/other → персональная обложка с портретом
    // Ученики с none → одна общая обложка без фото (все одинаковые)
    var portraitStudents = [];
    var hasNoPhoto = false;

    for (var s = 0; s < parsed.students.length; s++) {
        var st = parsed.students[s];
        var mode = trimStr(st.coverMode).toLowerCase();
        if (mode === "none") {
            hasNoPhoto = true;
        } else {
            // same или other — персональная обложка
            portraitStudents.push(st);
        }
    }

    // --- Подтверждение ---
    var msg =
        "СБОРКА ОБЛОЖЕК" + CRLF + CRLF +
        "Город: "  + (meta.city      || "(не указан)")   + CRLF +
        "Школа: "  + (meta.school    || "(не указана)")  + CRLF +
        "Класс: "  + (meta.className || "(не определён)") + CRLF +
        "Год: "    + (meta.year      || "(не указан)")   + CRLF + CRLF +
        "Обложек с портретом: " + portraitStudents.length + CRLF +
        "Обложек без фото: "   + (hasNoPhoto ? "1" : "0") + CRLF +
        "Итого страниц: " + (portraitStudents.length + (hasNoPhoto ? 1 : 0)) + CRLF + CRLF +
        "Продолжить?";
    if (!confirm(msg)) return;

    // --- Сборка ---
    var projectFolder = csvFile.parent.fsName;

    // Восстанавливаем facing pages — мастер обложки двухстраничный (разворот)
    try { doc.documentPreferences.facingPages = true; } catch(e) {}

    var idx = buildImageIndex(photoFolder);
    var report = [];
    var totalErrors = 0, totalWarnings = 0;

    report.push("=== СБОРКА ОБЛОЖЕК ===");
    report.push("Город: "  + (meta.city      || ""));
    report.push("Школа: "  + (meta.school    || ""));
    report.push("Класс: "  + (meta.className || ""));
    report.push("Год: "    + (meta.year      || ""));
    report.push("Обложек с портретом: " + portraitStudents.length);
    report.push("Обложек без фото: "   + (hasNoPhoto ? "1" : "0"));
    report.push("");

    var totalSpreads = portraitStudents.length + (hasNoPhoto ? 1 : 0);

    // Подгоняем число разворотов (spreads)
    // Каждый разворот = 2 страницы
    var neededPages = totalSpreads * 2;
    while (doc.pages.length < neededPages) doc.pages.add(LocationOptions.AT_END);
    while (doc.pages.length > neededPages && doc.pages.length > 2) {
        doc.pages[doc.pages.length - 1].remove();
    }

    // --- Страницы с портретами ---
    report.push("--- ОБЛОЖКИ С ПОРТРЕТОМ ---");
    for (var i = 0; i < portraitStudents.length; i++) {
        var st = portraitStudents[i];

        // Каждый разворот — пара страниц. Правая страница разворота содержит дизайн.
        var spread = doc.spreads[i];
        if (!spread) { report.push("[ERR]  " + (i+1) + ". " + st.name + " | разворот не найден"); totalErrors++; continue; }

        // Применяем мастер к развороту
        try {
            for (var sp = 0; sp < spread.pages.length; sp++) {
                spread.pages[sp].appliedMaster = masterPortrait;
            }
        } catch(e) {}

        // Ищем правую страницу разворота (index 1 если есть, иначе 0)
        var rightPage = spread.pages.length > 1 ? spread.pages[1] : spread.pages[0];

        clearOverrides(rightPage);
        overrideMaster(rightPage);
        var items = snapshotItems(rightPage);
        var byLabel = {};
        for (var j = 0; j < items.length; j++) {
            var lbl; try { lbl = items[j].label; } catch(e) { continue; }
            if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
        }

        // Метаданные
        setLabel(byLabel, "coverCity",   meta.city);
        setLabel(byLabel, "coverSchool", meta.school);
        setLabel(byLabel, "coverClass",  meta.className);
        setLabel(byLabel, "coverYear",   meta.year);
        setLabel(byLabel, "coverName",   st.name);

        // Фото
        var mode = trimStr(st.coverMode).toLowerCase();
        var photoFilename = (mode === "other" && st.coverPortrait !== "")
            ? st.coverPortrait
            : st.portrait;

        var found = findInIndex(idx, photoFilename);
        if (!found) {
            report.push("[WARN] " + (i+1) + ". " + st.name + " | mode:" + mode + " | НЕТ_ФАЙЛА:" + photoFilename);
            totalWarnings++;
        } else {
            var frame = byLabel["coverPhoto"];
            if (frame) {
                var ok = placeImage(frame, found.file);
                report.push((ok ? "[OK]   " : "[ERR]  ") + (i+1) + ". " + st.name +
                            " | mode:" + mode + " | фото:" + photoFilename);
                if (!ok) totalErrors++;
            } else {
                report.push("[ERR]  " + (i+1) + ". " + st.name + " | НЕТ_ФРЕЙМА coverPhoto");
                totalErrors++;
            }
        }
    }

    // --- Разворот без фото ---
    if (hasNoPhoto) {
        var lastSpread = doc.spreads[portraitStudents.length];
        if (lastSpread) {
            try {
                for (var np = 0; np < lastSpread.pages.length; np++) {
                    lastSpread.pages[np].appliedMaster = masterNoPhoto;
                }
            } catch(e) {}

            var noPhotoPage = lastSpread.pages.length > 1 ? lastSpread.pages[1] : lastSpread.pages[0];
            clearOverrides(noPhotoPage);
            overrideMaster(noPhotoPage);
            var noItems = snapshotItems(noPhotoPage);
            var noLabel = {};
            for (var k = 0; k < noItems.length; k++) {
                var nl; try { nl = noItems[k].label; } catch(e) { continue; }
                if (nl && nl !== "" && !noLabel[nl]) noLabel[nl] = noItems[k];
            }
            setLabel(noLabel, "coverCity",   meta.city);
            setLabel(noLabel, "coverSchool", meta.school);
            setLabel(noLabel, "coverClass",  meta.className);
            setLabel(noLabel, "coverYear",   meta.year);
        }
        report.push("");
        report.push("--- ОБЛОЖКА БЕЗ ФОТО ---");
        report.push("[OK]   Метаданные заполнены");
    }

    report.push("");
    report.push("=== ИТОГО ===");
    report.push("Разворотов создано: " + totalSpreads);
    report.push("Ошибок: " + totalErrors);
    report.push("Предупреждений: " + totalWarnings);

    saveReport(projectFolder, "build_cover_report.txt", report);

    alert("ОБЛОЖКИ ГОТОВЫ!" + CRLF + CRLF +
          "Разворотов: " + totalSpreads + CRLF +
          "Ошибок: " + totalErrors + CRLF +
          "Предупреждений: " + totalWarnings + CRLF + CRLF +
          "Отчёт: build_cover_report.txt");
}

// ========================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ========================================================

function setLabel(byLabel, label, text) {
    var item = byLabel[label];
    if (!item) return;
    try { item.contents = text || ""; } catch(e) {}
}

function fillByLabel(byLabel, label, text, report, fieldName) {
    var item = byLabel[label];
    if (!item) { report.push("[WARN] Метка не найдена: " + label); return; }
    try {
        item.contents = text || "";
        if (text) report.push("[OK]   " + fieldName + ": " + text);
    } catch(e) { report.push("[ERR]  Ошибка заполнения: " + label); }
}

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
        var masterItems = page.masterPageItems;
        for (var i = 0; i < masterItems.length; i++) {
            try { masterItems[i].override(page); } catch(e) {}
        }
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

function snapshotItems(page) {
    var arr = [];
    try {
        var live = page.allPageItems;
        for (var i = 0; i < live.length; i++) {
            try { void live[i].label; arr.push(live[i]); } catch(e) {}
        }
    } catch(e) {}
    return arr;
}

function placeImage(frame, file) {
    try {
        frame.place(file);
        frame.fit(FitOptions.FILL_PROPORTIONALLY);
        frame.fit(FitOptions.CENTER_CONTENT);
        return true;
    } catch(e) { return false; }
}

function saveReport(folder, filename, lines) {
    var f = new File(folder + "/" + filename);
    f.encoding = "UTF-8";
    f.lineFeed = "Windows";
    f.open("w");
    for (var i = 0; i < lines.length; i++) f.writeln(lines[i]);
    f.close();
}

function trimStr(s) {
    if (!s) return "";
    var r = s;
    while (r.length > 0 && (r.charAt(0) === ' ' || r.charAt(0) === '\t' || r.charAt(0) === '\r')) r = r.substring(1);
    while (r.length > 0 && (r.charAt(r.length-1) === ' ' || r.charAt(r.length-1) === '\t' || r.charAt(r.length-1) === '\r')) r = r.substring(0, r.length-1);
    return r;
}

function getField(fields, idx) {
    if (idx < 0 || idx >= fields.length) return "";
    return trimStr(fields[idx] || "");
}

// ========================================================
// ИНДЕКС ИЗОБРАЖЕНИЙ
// ========================================================

function buildImageIndex(rootFolder) {
    var exact = {}, canon = {}, canonDupes = {}, duplicates = [], count = 0;
    var extensions = { "jpg":1,"jpeg":1,"png":1,"tif":1,"tiff":1,"psd":1 };

    function canonKey(s) {
        var k = s.toLowerCase();
        var nfc = "";
        for (var ni = 0; ni < k.length; ni++) {
            var ch = k.charAt(ni), code = k.charCodeAt(ni);
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

    function nfcName(s) {
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
            fname = nfcName(fname);
            var dot = fname.lastIndexOf(".");
            if (dot < 0) continue;
            if (!extensions[fname.substring(dot+1).toLowerCase()]) continue;
            var eKey = fname.toLowerCase();
            if (!exact[eKey]) { exact[eKey] = f; count++; }
            else duplicates.push(fname);
            var cKey = canonKey(fname);
            if (canon[cKey] && canon[cKey].fsName !== f.fsName) canonDupes[cKey] = 1;
            else canon[cKey] = f;
        }
    }
    if (rootFolder && rootFolder.exists) scan(rootFolder);
    return { exact:exact, canon:canon, canonDupes:canonDupes,
             canonKey:canonKey, count:count, duplicates:duplicates };
}

function findInIndex(idx, filename) {
    if (!filename || filename === "") return null;
    var eKey = filename.toLowerCase();
    if (idx.exact[eKey]) return { file: idx.exact[eKey], fuzzy: false };
    var cKey = idx.canonKey(filename);
    if (idx.canon[cKey] && !idx.canonDupes[cKey]) return { file: idx.canon[cKey], fuzzy: true };
    return null;
}

// ========================================================
// ПАРСЕР CSV
// ========================================================

function parseCSV(path) {
    var result = {
        students: [],
        teachers: [],
        meta: { city: "", school: "", year: "", className: "" },
        errors: []
    };

    var file = new File(path);
    if (!file.exists) { result.errors.push("Файл не найден: " + path); return result; }
    file.encoding = "UTF-8";
    if (!file.open("r")) { result.errors.push("Не удалось открыть файл."); return result; }
    var raw = file.read();
    file.close();
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);

    var lines = splitLines(raw);
    if (lines.length < 2) { result.errors.push("CSV пустой."); return result; }

    // META может быть первой строкой
    var headerLineIdx = 0;
    var firstFields = parseCSVLine(lines[0]);
    if (trimStr(firstFields[0] || "") === "META") {
        result.meta.city   = trimStr(firstFields[1] || "");
        result.meta.school = trimStr(firstFields[2] || "");
        result.meta.year   = trimStr(firstFields[3] || "");
        headerLineIdx = 1;
    }

    var header = parseCSVLine(lines[headerLineIdx]);
    var cols = buildColIdx(header);

    for (var i = headerLineIdx + 1; i < lines.length; i++) {
        var line = lines[i];
        if (trimStr(line) === "") continue;
        var fields = parseCSVLine(line);
        if (fields.length < 2) continue;

        var rowClass = getField(fields, cols.klass);
        if (rowClass === "META" || rowClass === "") continue;
        if (rowClass === "\u0423\u0427\u0418\u0422\u0415\u041b\u042c") continue;

        var sname = getField(fields, cols.name);
        if (sname === "") continue;

        if (result.meta.className === "") result.meta.className = rowClass;

        result.students.push({
            name:          sname,
            portrait:      getField(fields, cols.portrait),
            coverMode:     getField(fields, cols.cover),
            coverPortrait: getField(fields, cols.coverPortrait),
            className:     rowClass
        });
    }

    return result;
}

function buildColIdx(header) {
    var idx = { klass:-1, name:-1, portrait:-1, cover:-1, coverPortrait:-1 };
    for (var i = 0; i < header.length; i++) {
        var col = trimStr(header[i]).toLowerCase();
        if      (col === "\u043a\u043b\u0430\u0441\u0441") idx.klass = i;
        else if (col === "\u0443\u0447\u0435\u043d\u0438\u043a") idx.name = i;
        else if (col === "\u043f\u043e\u0440\u0442\u0440\u0435\u0442_\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430") idx.portrait = i;
        else if (col === "\u043e\u0431\u043b\u043e\u0436\u043a\u0430") idx.cover = i;
        else if (col === "\u043f\u043e\u0440\u0442\u0440\u0435\u0442_\u043e\u0431\u043b\u043e\u0436\u043a\u0430") idx.coverPortrait = i;
    }
    return idx;
}

function parseCSVLine(line) {
    var fields = [], current = "", inQuotes = false, i = 0;
    while (i < line.length) {
        var ch = line.charAt(i);
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line.charAt(i+1) === '"') {
                current += '"'; i += 2; continue;
            }
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            fields.push(current); current = "";
        } else { current += ch; }
        i++;
    }
    fields.push(current);
    return fields;
}

function splitLines(text) {
    var norm = "";
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (ch === '\r') {
            norm += '\n';
            if (i+1 < text.length && text.charAt(i+1) === '\n') i++;
        } else norm += ch;
    }
    var lines = [], start = 0;
    for (var j = 0; j <= norm.length; j++) {
        if (j === norm.length || norm.charAt(j) === '\n') {
            lines.push(norm.substring(start, j));
            start = j + 1;
        }
    }
    return lines;
}

main();
