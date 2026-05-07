// ========================================================
// АВТОВЁРСТКА АЛЬБОМА v1.0
// Главный скрипт сборки. Собирает альбом с нуля:
//   layflat:       стр.1=классрук, стр.2=учителя, стр.3-N=ученики
//   мягкие листы:  стр.1=пусто(вступление), стр.2=классрук,
//                  стр.3=учителя, стр.4-N=ученики
//
// Требует в документе мастера:
//   E-Student-Default         — страница ученика
//   F-HeadTeacher             — страница классрука
//   G-TeachersGrid-WithPhoto  — страница предметников (до 8)
// ========================================================

#target indesign

// ========================================================
// ТОЧКА ВХОДА
// ========================================================

function main() {
    if (app.documents.length === 0) {
        alert("Откройте шаблон InDesign и запустите снова.");
        return;
    }

    var doc = app.activeDocument;
    var CRLF = String.fromCharCode(13) + String.fromCharCode(10);

    // --- Диалог 1: тип печати ---
    var printType = prompt(
        "ТИП ПЕЧАТИ:" + CRLF +
        "1 — Layflat (плотные листы, альбом начинается с разворота)" + CRLF +
        "2 — Мягкие листы (альбом начинается с правой страницы)" + CRLF + CRLF +
        "Введите 1 или 2:",
        "1"
    );

    if (!printType) return;
    printType = trimStr(printType);
    if (printType !== "1" && printType !== "2") {
        alert("Неверный выбор. Введите 1 или 2.");
        return;
    }

    var isLayflat = (printType === "1");

    // --- Диалог 2: комплектация ---
    var configType = prompt(
        "КОМПЛЕКТАЦИЯ:" + CRLF +
        "1 — Стандарт    (1 стр/ученик: портрет + имя + цитата)" + CRLF +
        "2 — Универсал   (1 стр/ученик: + 2 фото с друзьями)" + CRLF +
        "3 — Максимум    (1 разворот/ученик: 2 стр.)" + CRLF +
        "4 — Медиум      (сетка 4 ученика на странице)" + CRLF +
        "5 — Лайт        (сетка 6-24 ученика на 4 стр.)" + CRLF +
        "6 — Мини        (сетка на 6 стр.)" + CRLF +
        "7 — Индивидуальный (детский сад)" + CRLF + CRLF +
        "Введите номер (1-7):" + CRLF +
        "Сейчас реализованы: 1 (Стандарт) и 2 (Универсал)",
        "2"
    );
    if (!configType) return;
    configType = trimStr(configType);

    // --- Диалог 3: CSV ---
    var csvFile = File.openDialog("Выберите data.csv из папки проекта", "*.csv");
    if (!csvFile) return;

    // --- Парсинг CSV ---
    var parsed = parseCSV(csvFile.fsName);
    if (parsed.errors.length > 0) {
        alert("Ошибки при чтении CSV:" + CRLF + parsed.errors.join(CRLF));
        return;
    }
    if (parsed.students.length === 0) {
        alert("В CSV не найдено учеников.");
        return;
    }

    // --- Диалог 4: папка с фото ---
    // ВАЖНО: выбирай КОРНЕВУЮ папку, которая содержит ВСЕ подпапки с фото
    // (папки с портретами учеников, учителей, фото с друзьями — все вместе)
    // Скрипт сам найдёт нужные файлы по именам из CSV во всех подпапках
    var photoFolder = Folder.selectDialog(
        "Выберите КОРНЕВУЮ папку с фото." + CRLF +
        "Папка должна содержать ВСЕ подпапки: портреты учеников, фото учителей, фото с друзьями." + CRLF +
        "Скрипт сканирует рекурсивно.",
        csvFile.parent
    );
    if (!photoFolder) return;

    // --- Разделяем учителей ---
    var headTeacher = null;
    var subjects = [];
    for (var t = 0; t < parsed.teachers.length; t++) {
        if (parsed.teachers[t].isHead && !headTeacher) {
            headTeacher = parsed.teachers[t];
        } else {
            subjects.push(parsed.teachers[t]);
        }
    }

    // --- Подтверждение ---
    var configLabels = {"1":"Стандарт","2":"Универсал","3":"Максимум","4":"Медиум","5":"Лайт","6":"Мини","7":"Индивидуальный"};
    var typeLabel = isLayflat ? "Layflat" : "Мягкие листы";
    var totalPages = (isLayflat ? 0 : 1) + 2 + parsed.students.length;
    var msg =
        "СБОРКА АЛЬБОМА" + CRLF + CRLF +
        "Тип печати: " + typeLabel + CRLF +
        "Комплектация: " + (configLabels[configType] || configType) + CRLF +
        "Город: "    + (parsed.meta.city      || "(не указан)") + CRLF +
        "Школа: "    + (parsed.meta.school    || "(не указана)") + CRLF +
        "Класс: "    + (parsed.meta.className || "(не определён)") + CRLF +
        "Год: "      + (parsed.meta.year      || "(не указан)") + CRLF + CRLF +
        "Классрук: " + (headTeacher ? headTeacher.name : "НЕ НАЙДЕН") + CRLF +
        "Предметников: " + subjects.length + CRLF +
        "Учеников: " + parsed.students.length + CRLF +
        "Папка с фото: " + photoFolder.fsName + CRLF + CRLF +
        "ВНИМАНИЕ: все существующие страницы будут удалены!" + CRLF + CRLF +
        "Продолжить?";

    if (!confirm(msg)) return;

    // --- Запускаем сборку напрямую ---
    var projectFolder = csvFile.parent.fsName;

    buildAlbum(
        app.activeDocument, isLayflat, configType,
        headTeacher, subjects, parsed.students,
        parsed.meta, projectFolder, photoFolder
    );
}

// ========================================================
// СБОРКА АЛЬБОМА
// ========================================================

function buildAlbum(doc, isLayflat, configType,
                    headTeacher, subjects, students,
                    meta, projectFolder, photoFolder) {

    var CRLF = String.fromCharCode(13) + String.fromCharCode(10);
    var report = [];
    var totalErrors = 0;
    var totalWarnings = 0;
    var configLabels = {"1":"Стандарт","2":"Универсал","3":"Максимум","4":"Медиум","5":"Лайт","6":"Мини","7":"Индивидуальный"};

    // Специальный режим: Мини + мягкие листы
    // В этом режиме учителя помещаются на стр.1 (правая), личные страницы — с стр.2
    // S-Intro не создаётся, G-мастер правой учительской страницы — не нужен
    var isMiniSoft = (configType === "6" && !isLayflat);

    // Ищем все мастера
    var masterStudent      = findMaster(doc, "E", "Student-Default");  // fallback
    var masterStudentStd   = findMaster(doc, "E", "Student-Standard");
    var masterStudentLeft  = findMaster(doc, "E", "Student-Left");  // Универсал левая
    var masterStudentRight = findMaster(doc, "E", "Student-Right"); // Универсал правая
    var masterMaxLeft      = findMaster(doc, "E", "Max-Left");      // Максимум / Индивидуальный — левая
    var masterMaxRight     = findMaster(doc, "E", "Max-Right");     // Максимум / Индивидуальный — правая (4 фото)
    var masterIndRight3    = findMaster(doc, "E", "Ind-Right-3");   // Индивидуальный — правая (3 фото)
    // Медиум (D)
    var masterMediumLeft        = findMaster(doc, "D", "Medium-Left");
    var masterMediumRight       = findMaster(doc, "D", "Medium-Right");
    var masterMediumLastPhoto   = findMaster(doc, "D", "Medium-Last-WithPhoto");
    // Overflow мастера (Лайт / Мини)
    var masterLightOverflowRow  = findMaster(doc, "L", "Overflow-Row");        // LEFT: 3 уч. + classPhoto
    var masterLightOverflowRowR = findMaster(doc, "L", "Overflow-Row-Right");  // RIGHT: 3 уч. + classPhoto (31-33 уч.)
    var masterMiniOverflowRow   = findMaster(doc, "N", "Overflow-Row");        // LEFT: 4 уч. + classPhoto
    var masterMiniOverflowRowR  = findMaster(doc, "N", "Overflow-Row-Right");  // RIGHT зеркало (пока не используется)
    // Новые J-мастера Фаза 2
    var masterJHalfSixth   = findMaster(doc, "J", "HalfSixth");
    var masterJSixthFull   = findMaster(doc, "J", "SixthFull");
    var masterJSixthSixth  = findMaster(doc, "J", "SixthSixth");
    // Лайт (L) — пары по числу слотов на странице
    var masterLight2Left   = findMaster(doc, "L", "2-Left");
    var masterLight2Right  = findMaster(doc, "L", "2-Right");
    var masterLight3Left   = findMaster(doc, "L", "3-Left");
    var masterLight3Right  = findMaster(doc, "L", "3-Right");
    var masterLight4Left   = findMaster(doc, "L", "4-Left");
    var masterLight4Right  = findMaster(doc, "L", "4-Right");
    var masterLight6Left   = findMaster(doc, "L", "6-Left");
    var masterLight6Right  = findMaster(doc, "L", "6-Right");
    // Мини (N) — пары по числу слотов на странице
    var masterMini4Left    = findMaster(doc, "N", "4-Left");
    var masterMini4Right   = findMaster(doc, "N", "4-Right");
    var masterMini6Left    = findMaster(doc, "N", "6-Left");
    var masterMini6Right   = findMaster(doc, "N", "6-Right");
    var masterMini9Left    = findMaster(doc, "N", "9-Left");
    var masterMini9Right   = findMaster(doc, "N", "9-Right");
    var masterMini12Left   = findMaster(doc, "N", "12-Left");
    var masterMini12Right  = findMaster(doc, "N", "12-Right");
    // Таблицы поиска мастеров по числу слотов
    var lightMastersLeft   = { "2": masterLight2Left,  "3": masterLight3Left,  "4": masterLight4Left,  "6": masterLight6Left  };
    var lightMastersRight  = { "2": masterLight2Right, "3": masterLight3Right, "4": masterLight4Right, "6": masterLight6Right };
    var miniMastersLeft    = { "4": masterMini4Left,  "6": masterMini6Left,  "9": masterMini9Left,  "12": masterMini12Left  };
    var miniMastersRight   = { "4": masterMini4Right, "6": masterMini6Right, "9": masterMini9Right, "12": masterMini12Right };
    // Учительские мастера — левые страницы (F)
    var masterFWithPhoto   = findMaster(doc, "F", "Head-WithPhoto");
    var masterFSmallGrid   = findMaster(doc, "F", "Head-SmallGrid");
    var masterFLargeGrid   = findMaster(doc, "F", "Head-LargeGrid");
    // Зеркальные F-мастера для правой страницы (Мини мягкие листы, стр.1 = RIGHT)
    // Создаются дизайнером — те же метки, контент расположен для правой страницы
    var masterFWithPhotoR  = findMaster(doc, "F", "Head-WithPhoto-R");
    var masterFSmallGridR  = findMaster(doc, "F", "Head-SmallGrid-R");
    var masterFLargeGridR  = findMaster(doc, "F", "Head-LargeGrid-R");
    // Учительские мастера — правые страницы (G)
    var masterGHalfClass   = findMaster(doc, "G", "HalfClass");
    var masterGFullClass   = findMaster(doc, "G", "FullClass");
    var masterGTeachers3x3 = findMaster(doc, "G", "Teachers-3x3");
    var masterGTeachers4x3 = findMaster(doc, "G", "Teachers-4x3");
    var masterGTeachers4x4 = findMaster(doc, "G", "Teachers-4x4");
    // Общий раздел — старые мастера (действуют до создания J-HalfSixth и т.д.)
    var masterCollage      = findMaster(doc, "J", "Collage");
    var masterHalf         = findMaster(doc, "J", "Half");
    var masterQuarter      = findMaster(doc, "J", "Quarter");
    var masterJClassPhoto  = findMaster(doc, "J", "ClassPhoto");
    var masterJClassPhotoR = findMaster(doc, "J", "ClassPhoto-Right");
    // Новые J-мастера по ТЗ (Фаза 2 — создаются позже)
    var masterJHalfSixth   = findMaster(doc, "J", "HalfSixth");
    var masterJSixthFull   = findMaster(doc, "J", "SixthFull");
    var masterJSixthSixth  = findMaster(doc, "J", "SixthSixth");
    // Вступительная страница — только для мягких листов (стр.1 правая)
    // Содержит метку classPhotoFrame для общего фото
    var masterIntro = findMaster(doc, "S", "Intro");

    // Обязательные мастера учителей
    if (!masterFWithPhoto || !masterFSmallGrid || !masterFLargeGrid) {
        var missing2 = [];
        if (!masterFWithPhoto) missing2.push("F-Head-WithPhoto");
        if (!masterFSmallGrid) missing2.push("F-Head-SmallGrid");
        if (!masterFLargeGrid) missing2.push("F-Head-LargeGrid");
        alert("Не найдены мастера учителей:" + CRLF + missing2.join(CRLF));
        return;
    }
    // Базовый путь к папке common/ — пробуем рядом с CSV, потом рядом с фото
    var commonBase = projectFolder;
    if (!new Folder(commonBase + "/common").exists) {
        if (new Folder(photoFolder.fsName + "/common").exists) {
            commonBase = photoFolder.fsName;
        }
    }
    report.push("Папка common/: " + commonBase + "/common");

    // Загружаем все фото из common/ и инициализируем счётчики
    // Счётчики сквозные: учителя → обязательный раздел → дополнительный раздел
    var photos = {
        fullClass: getSortedImages(new Folder(commonBase + "/common/class_full")),
        half:      getSortedImages(new Folder(commonBase + "/common/half")),
        quarter:   getSortedImages(new Folder(commonBase + "/common/quarter")),
        collage:   getSortedImages(new Folder(commonBase + "/common/collage"))
    };
    var photoIdx = { fullClass: 0, half: 0, quarter: 0, collage: 0 };

    // ── Загружаем фоны из common/backgrounds/ ──
    // Каждая подпапка — категория. Файлы берутся в алфавитном порядке, применяются циклически.
    // Если папки нет или пустая — фоны для этой категории не вставляются.
    var bgBase = commonBase + "/common/backgrounds";
    var backgrounds = {
        intro:    getSortedImages(new Folder(bgBase + "/Вступление")),
        teachers: getSortedImages(new Folder(bgBase + "/Учителя")),
        vignette: getSortedImages(new Folder(bgBase + "/Виньетки")),
        personal: getSortedImages(new Folder(bgBase + "/Личный")),
        common:   getSortedImages(new Folder(bgBase + "/Общие"))
    };
    var bgCounts = { intro: 0, teachers: 0, vignette: 0, personal: 0, common: 0 };
    var hasBg = (backgrounds.intro.length + backgrounds.teachers.length +
                 backgrounds.vignette.length + backgrounds.personal.length +
                 backgrounds.common.length) > 0;
    if (hasBg) {
        report.push("[INFO] Фоны: вступление=" + backgrounds.intro.length +
                    " учителя=" + backgrounds.teachers.length +
                    " виньетки=" + backgrounds.vignette.length +
                    " личный=" + backgrounds.personal.length +
                    " общие=" + backgrounds.common.length);
    }

    // Ищем слой «Фон» для размещения фоновых фреймов
    var bgLayer = null;
    if (hasBg) {
        for (var li = 0; li < doc.layers.length; li++) {
            if (doc.layers[li].name === "Фон") { bgLayer = doc.layers[li]; break; }
        }
        if (!bgLayer) {
            // Создаём слой «Фон» в самом низу
            bgLayer = doc.layers.add();
            bgLayer.name = "Фон";
            // Перемещаем в конец (нижний слой)
            bgLayer.move(LocationOptions.AT_END);
            report.push("[INFO] Создан слой «Фон» для фоновых изображений");
        }
    }

    // Функция вставки фона на разворот страницы
    // category: "intro" | "teachers" | "vignette" | "personal" | "common"
    // page: текущая страница
    // isSinglePage: true для одиночных страниц (стр.1 мягкие, isMiniSoft)
    function applyBackground(category, page, isSinglePage) {
        if (!hasBg || !bgLayer) return;
        var pool = backgrounds[category];
        if (!pool || pool.length === 0) return;

        var bgFile = pool[bgCounts[category] % pool.length];
        bgCounts[category]++;

        try {
            // Определяем размеры и позицию
            var spread = page.parent; // Spread
            var pb = page.bounds;     // [top, left, bottom, right]
            var pageH = pb[2] - pb[0];

            // Для разворота: фрейм занимает обе страницы
            // Для одиночной страницы: только одну
            var left, right;
            if (isSinglePage || spread.pages.length < 2) {
                left  = pb[1];
                right = pb[3];
            } else {
                // Левый край первой страницы → правый край второй
                var sp0 = spread.pages[0].bounds;
                var sp1 = spread.pages[spread.pages.length - 1].bounds;
                left  = sp0[1];
                right = sp1[3];
            }
            var top    = pb[0];
            var bottom = pb[0] + pageH;

            // ВАЖНО: добавляем фрейм на spread (не на doc!) — иначе все фреймы
            // оказываются на первом развороте
            var frame = spread.rectangles.add({ itemLayer: bgLayer });
            frame.geometricBounds = [top, left, bottom, right];
            frame.place(bgFile);
            frame.fit(FitOptions.FILL_PROPORTIONALLY);
            frame.fit(FitOptions.CENTER_CONTENT);

            // Убедимся что фон за всеми элементами — отправляем на задний план
            try { frame.sendToBack(); } catch(e) {}

        } catch(e) {
            report.push("[WARN] Фон: ошибка вставки (" + category + "): " + e.message);
        }
    }

    // J-мастера опциональны — поддерживаем и старые и новые
    var hasCommonSection = masterCollage || masterHalf || masterQuarter || masterJClassPhoto ||
                           masterJHalfSixth || masterJSixthFull || masterJSixthSixth;

    report.push("=== АВТОВЁРСТКА АЛЬБОМА ===");
    report.push("Дата: " + new Date().toString());
    report.push("Документ: " + doc.name);
    report.push("Тип печати: " + (isLayflat ? "Layflat" : "Мягкие листы"));
    report.push("Комплектация: " + (configLabels[configType] || configType));
    report.push("Папка с фото: " + photoFolder.fsName);
    report.push("");
    report.push("ПРОЕКТ:");
    report.push("  Город:  " + (meta.city   || "(не указан)"));
    report.push("  Школа:  " + (meta.school || "(не указана)"));
    report.push("  Класс:  " + (meta.className || "(не определён)"));
    report.push("  Год:    " + (meta.year   || "(не указан)"));
    report.push("");

    // --- Индекс изображений ---
    var idx = buildImageIndex(photoFolder);
    report.push("Найдено изображений: " + idx.count);
    if (idx.duplicates.length > 0) {
        report.push("[WARN] Дубликаты имён файлов (" + idx.duplicates.length + "):");
        for (var d = 0; d < Math.min(idx.duplicates.length, 5); d++) {
            report.push("  " + idx.duplicates[d]);
        }
        totalWarnings += idx.duplicates.length;
    }
    report.push("");

    // --- Выбор сценария учителей по ТЗ ---
    var subjectCount = subjects.length;
    var scenario, scenarioLabel;
    var masterLeft, masterRight;
    var leftData, rightData;

    // Правая страница для 0-8 предметников зависит от наличия фото в common/
    // Приоритет: 1) G-HalfClass (есть half_left + half_right), 2) G-FullClass (есть full_class), 3) пусто
    function pickRightPhotoMaster() {
        if (photos.half.length > photoIdx.half + 1) {
            return masterGHalfClass;   // есть хотя бы 2 фото полкласса
        }
        if (photos.fullClass.length > photoIdx.fullClass) {
            return masterGFullClass;   // есть общее фото
        }
        return null;
    }

    if (subjectCount === 0) {
        // 0 предметников: F-Head-WithPhoto слева + G-HalfClass/G-FullClass/пусто справа
        scenario   = "headonly";
        masterLeft = masterFWithPhoto;
        masterRight = pickRightPhotoMaster();
        leftData   = { head: headTeacher };
        rightData  = null;
        scenarioLabel = "0 предм.: Head-WithPhoto + " + (masterRight ? masterRight.baseName : "пусто");

    } else if (subjectCount <= 4) {
        // 1-4 предметников: F-Head-SmallGrid слева + G-HalfClass/G-FullClass/пусто справа
        scenario   = "small";
        masterLeft = masterFSmallGrid;
        masterRight = pickRightPhotoMaster();
        leftData   = { head: headTeacher, sideTeachers: subjects };
        rightData  = null;
        scenarioLabel = "1-4 предм. (" + subjectCount + "): Head-SmallGrid + " + (masterRight ? masterRight.baseName : "пусто");

    } else if (subjectCount <= 8) {
        // 5-8 предметников: F-Head-LargeGrid слева + G-HalfClass/G-FullClass/пусто справа
        scenario   = "large_small";
        masterLeft = masterFLargeGrid;
        masterRight = pickRightPhotoMaster();
        leftData   = { head: headTeacher, sideTeachers: subjects };
        rightData  = null;
        scenarioLabel = "5-8 предм. (" + subjectCount + "): Head-LargeGrid + " + (masterRight ? masterRight.baseName : "пусто");

    } else if (subjectCount === 9) {
        // 9 предметников: F-Head-WithPhoto + G-Teachers-3x3
        scenario   = "grid_9";
        masterLeft = masterFWithPhoto;
        masterRight = masterGTeachers3x3;
        leftData   = { head: headTeacher };
        rightData  = { teachers: subjects, maxSlots: 9 };
        scenarioLabel = "9 предм.: Head-WithPhoto + Teachers-3x3";

    } else if (subjectCount <= 12) {
        // 10-12 предметников: F-Head-WithPhoto + G-Teachers-4x3
        scenario   = "grid_12";
        masterLeft = masterFWithPhoto;
        masterRight = masterGTeachers4x3;
        leftData   = { head: headTeacher };
        rightData  = { teachers: subjects, maxSlots: 12 };
        scenarioLabel = "10-12 предм. (" + subjectCount + "): Head-WithPhoto + Teachers-4x3";

    } else if (subjectCount <= 16) {
        // 13-16 предметников: F-Head-WithPhoto + G-Teachers-4x4
        scenario   = "grid_16";
        masterLeft = masterFWithPhoto;
        masterRight = masterGTeachers4x4;
        leftData   = { head: headTeacher };
        rightData  = { teachers: subjects, maxSlots: 16 };
        scenarioLabel = "13-16 предм. (" + subjectCount + "): Head-WithPhoto + Teachers-4x4";

    } else {
        // 17-24+ предметников: F-Head-LargeGrid + G-Teachers-4x4
        scenario   = "overflow";
        masterLeft = masterFLargeGrid;
        masterRight = masterGTeachers4x4;
        leftData   = { head: headTeacher, sideTeachers: subjects.slice(0, 8) };
        rightData  = { teachers: subjects.slice(8), maxSlots: 16 };
        scenarioLabel = "17+ предм. (" + subjectCount + "): Head-LargeGrid + Teachers-4x4";
    }
    report.push("Сценарий учителей: " + scenarioLabel);

    // isMiniSoft: страница 1 — standalone RIGHT.
    // Используем F-*-R мастера. Они должны быть ОДНОСТРОЧНЫМИ (1-page) мастерами.
    // С однострочным мастером: page.masterPageItems возвращает все элементы,
    // positions x=0..pageWidth → применяется корректно к standalone странице.
    // Стандартный overrideMaster(page) работает без хаков.
    //
    // КАК СОЗДАТЬ однострочный мастер в InDesign:
    //   Панель Pages → меню → New Master → Number of Pages: 1
    //   Скопировать содержимое с F-Head-*-Left страницы, назвать F-Head-*-R
    if (isMiniSoft) {
        var fRMaster = null;
        if      (masterLeft === masterFWithPhoto  && masterFWithPhotoR)  fRMaster = masterFWithPhotoR;
        else if (masterLeft === masterFSmallGrid  && masterFSmallGridR)  fRMaster = masterFSmallGridR;
        else if (masterLeft === masterFLargeGrid  && masterFLargeGridR)  fRMaster = masterFLargeGridR;
        if (fRMaster) {
            masterLeft = fRMaster;
            report.push("[INFO] isMiniSoft: применён F-*-R мастер (" + fRMaster.name + ")");
        } else {
            report.push("[WARN] isMiniSoft: однострочный мастер F-*-R не найден. " +
                "Создайте 1-page мастера: F-Head-WithPhoto-R / F-Head-SmallGrid-R / F-Head-LargeGrid-R");
            totalWarnings++;
        }
    }

    // Выбираем мастер ученика по комплектации
    var activeStudentMaster = masterStudent; // fallback — E-Student-Default (2-стр)
    var isMaximum = (configType === "3");
    var isGridConfig = (configType === "4" || configType === "5" || configType === "6");
    if (configType === "1") {
        // Стандарт: E-Student-Standard (2-стр)
        if (masterStudentStd) {
            activeStudentMaster = masterStudentStd;
        } else {
            report.push("[WARN] E-Student-Standard не найден — используется E-Student-Default");
            totalWarnings++;
        }
    } else if (isMaximum) {
        // Максимум: E-Max-Left / E-Max-Right
        if (masterMaxLeft && masterMaxRight) {
            activeStudentMaster = null;
        } else {
            report.push("[WARN] E-Max-Left и/или E-Max-Right не найдены — используется E-Student-Default");
            totalWarnings++;
        }
    } else if (configType === "2") {
        // Универсал: E-Student-Left / E-Student-Right
        if (masterStudentLeft && masterStudentRight) {
            activeStudentMaster = null;
        } else {
            if (masterStudentLeft || masterStudentRight) {
                report.push("[WARN] Найден только один из E-Student-Left / E-Student-Right — используется E-Student-Default");
            }
            activeStudentMaster = masterStudent;
            totalWarnings++;
        }
    } else {
        // Медиум/Лайт/Мини (4-6) — сеточные комплектации, мастер выбирается per-page
        activeStudentMaster = null;
    }
    report.push("");

    // Сообщаем о старте
    try { app.statusBar.update("Автовёрстка: подготовка документа..."); } catch(e) {}

    // Оба типа (layflat и мягкие листы) используют startPageNumber=1.
    // Шаблон должен быть сохранён с startPageNumber=1 — скрипт это не меняет.

    // --- Сброс документа ---
    // isMiniSoft (Мини+мягкие): 1 зарезервированная страница (учительская, правая).
    // Все остальные типы: 3 зарезервированные страницы.
    var reservedPages = isMiniSoft ? 1 : 3;

    while (doc.pages.length > reservedPages) {
        doc.pages[doc.pages.length - 1].remove();
    }
    while (doc.pages.length < reservedPages) {
        doc.pages.add(LocationOptions.AT_END);
    }

    // --- Строим список страниц ---
    var pageQueue = [];

    if (isMiniSoft) {
        // Мини мягкие листы: стр.1 = учительская F-мастер (RIGHT), стр.2+ = личные.
        // G-мастер (правая учительского разворота) пропускается — half-фото идут в common.
        pageQueue.push({ master: masterLeft, role: "teacherLeft", data: leftData });
    } else {
        // Все остальные: стр.1 = вступление, стр.2 = классрук, стр.3 = учителя
        pageQueue.push({ master: null, role: "intro", data: null });
        pageQueue.push({ master: masterLeft,  role: "teacherLeft",  data: leftData });
        pageQueue.push({ master: masterRight, role: "teacherRight", data: rightData });
    }
    if (configType === "1" || configType === "2") {
        // Стандарт / Универсал: 1 страница на ученика
        for (var s = 0; s < students.length; s++) {
            pageQueue.push({ master: activeStudentMaster, role: "student", data: students[s] });
        }
    } else if (configType === "3") {
        // Максимум: 2 страницы на ученика — левая (портрет) и правая (4 фото)
        for (var s = 0; s < students.length; s++) {
            pageQueue.push({ master: masterMaxLeft,  role: "studentMaxLeft",  data: students[s] });
            pageQueue.push({ master: masterMaxRight, role: "studentMaxRight", data: students[s] });
        }
    } else if (configType === "4") {
        // Медиум: 4 ученика на страницу
        // Если остаток 1-2 ученика → последняя LEFT = D-Medium-Last-WithPhoto (уч. + фото класса)
        // Если остаток 3-4 → стандартная страница
        var mSlotsPerPage = 4;
        var mFullPages = Math.floor(students.length / mSlotsPerPage);
        var mRemainder = students.length % mSlotsPerPage;
        var mPageCount = Math.ceil(students.length / mSlotsPerPage);

        for (var mp = 0; mp < mFullPages; mp++) {
            var mSlice = students.slice(mp * mSlotsPerPage, (mp + 1) * mSlotsPerPage);
            pageQueue.push({ master: null, role: "studentGrid",
                             data: { students: mSlice, slotsPerPage: mSlotsPerPage, hasQuote: true,
                                     masterLeft: masterMediumLeft, masterRight: masterMediumRight } });
        }
        // Обработка остатка
        if (mRemainder > 0) {
            var mLastSlice = students.slice(mFullPages * mSlotsPerPage);
            if ((mRemainder === 1 || mRemainder === 2) && masterMediumLastPhoto) {
                // 1-2 ученика → D-Medium-Last-WithPhoto слева + G-HalfClass/G-FullClass справа
                pageQueue.push({ master: null, role: "mediumLastLeft",
                                 data: { students: mLastSlice } });
                pageQueue.push({ master: null, role: "mediumLastRight",
                                 data: null });
            } else {
                // 3-4 ученика → обычная страница (неполная)
                pageQueue.push({ master: null, role: "studentGrid",
                                 data: { students: mLastSlice, slotsPerPage: mSlotsPerPage, hasQuote: true,
                                         masterLeft: masterMediumLeft, masterRight: masterMediumRight } });
            }
        }
        report.push("Медиум: " + students.length + " учеников, " + mPageCount + " страниц (4 на стр.)" +
                    (mRemainder > 0 && mRemainder <= 2 && masterMediumLastPhoto ?
                     " | последний разворот: уч.+" + (masterGHalfClass ? "HalfClass" : "FullClass") : ""));
    } else if (configType === "5") {
        // Лайт: 4 базовых страницы + overflow при необходимости
        // По таблице:
        //   ≤24 учеников:  4 сетки, нет overflow
        //   25-27 учеников: 4 сетки + L-Overflow-Row (1-3 уч. + classPhotoFrame)
        //   28-30 учеников: 5 сеток (последняя неполная, без classPhotoFrame)
        //   31-32 учеников: 5 сеток + L-Overflow-Row (1-2 уч. + classPhotoFrame)
        //                   → нужен мастер L-6-Last (6 уч. + classPhotoFrame снизу)
        var lGrid = getLightGrid(students.length);
        var lBasePages = 4;
        var lMaxOnBase = lBasePages * lGrid.slotsPerPage;
        var lOverflow = students.length - lMaxOnBase;
        var lOverflowIsRow     = (lOverflow > 0 && lOverflow <= 3);  // 25-27
        var lOverflowIsGrid    = (lOverflow > 3 && lOverflow <= 6);  // 28-30: 5я обычная сетка
        var lOverflowIsGridRow = (lOverflow > 6);                    // 31-32: 5я сетка + 6я overflow-row
        var lHasOverflowRow    = lOverflowIsRow  && masterLightOverflowRow;
        var lHasGridRow        = lOverflowIsGridRow && masterLightOverflowRow;
        var lTotalStudentPages = lBasePages +
            (lOverflowIsRow ? 1 : lOverflowIsGrid ? 1 : lOverflowIsGridRow ? 2 : 0);

        report.push("Лайт: " + students.length + " учеников, сетка " + lGrid.cols + "x" + lGrid.rows +
                    " (" + lGrid.slotsPerPage + " на стр.), " + lTotalStudentPages + " страниц" +
                    (lOverflowIsRow     ? " (overflow-row: " + lOverflow + " уч.)" :
                     lOverflowIsGrid    ? " (5я сетка: " + lOverflow + " уч.)" :
                     lOverflowIsGridRow ? " (5я сетка 6 уч. + 6я overflow-row: " + (lOverflow - 6) + " уч.)" : ""));
        if (!lightMastersLeft[lGrid.suffix] || !lightMastersRight[lGrid.suffix]) {
            report.push("[WARN] Мастера L-" + lGrid.suffix + "-Left / L-" + lGrid.suffix + "-Right не найдены");
            totalWarnings++;
        }
        for (var lp = 0; lp < lBasePages; lp++) {
            var lSlice = students.slice(lp * lGrid.slotsPerPage, (lp + 1) * lGrid.slotsPerPage);
            pageQueue.push({ master: null, role: "studentGrid",
                             data: { students: lSlice, slotsPerPage: lGrid.slotsPerPage, hasQuote: false,
                                     masterLeft: lightMastersLeft[lGrid.suffix],
                                     masterRight: lightMastersRight[lGrid.suffix] } });
        }
        if (lHasOverflowRow) {
            // 25-27: L-Overflow-Row с classPhotoFrame
            var lOvfSlice = students.slice(lMaxOnBase);
            pageQueue.push({ master: null, role: "overflowRow",
                             data: { students: lOvfSlice, slotsPerPage: lGrid.slotsPerPage,
                                     masterLeft: masterLightOverflowRow,
                                     masterRight: lightMastersRight[lGrid.suffix] } });
        } else if (lOverflowIsGrid) {
            // 28-30: 5я обычная сетка (неполная, пустые слоты скроются)
            var l5Slice = students.slice(lMaxOnBase);
            pageQueue.push({ master: null, role: "studentGrid",
                             data: { students: l5Slice, slotsPerPage: lGrid.slotsPerPage, hasQuote: false,
                                     masterLeft: lightMastersLeft[lGrid.suffix],
                                     masterRight: lightMastersRight[lGrid.suffix] } });
        } else if (lOverflowIsGridRow) {
            // 31-32: 5я сетка (6 уч.) + 6я overflow-row (1-2 уч. + classPhotoFrame)
            // 5я страница: обычный L-6-Left (без classPhotoFrame)
            var l5GridSlice = students.slice(lMaxOnBase, lMaxOnBase + lGrid.slotsPerPage);
            pageQueue.push({ master: null, role: "studentGrid",
                             data: { students: l5GridSlice, slotsPerPage: lGrid.slotsPerPage, hasQuote: false,
                                     masterLeft:  lightMastersLeft[lGrid.suffix],
                                     masterRight: lightMastersRight[lGrid.suffix] } });
            // 6я страница: L-Overflow-Row-Right (RIGHT) или L-Overflow-Row если нет
            var l6OvfSlice = students.slice(lMaxOnBase + lGrid.slotsPerPage);
            if (lHasGridRow) {
                var lOvfRight = masterLightOverflowRowR || masterLightOverflowRow;
                if (!masterLightOverflowRowR) {
                    report.push("[WARN] Мастер L-Overflow-Row-Right не найден — создайте зеркало L-Overflow-Row для правой страницы");
                    totalWarnings++;
                }
                pageQueue.push({ master: null, role: "overflowRow",
                                 data: { students: l6OvfSlice, slotsPerPage: lGrid.slotsPerPage,
                                         masterLeft:  masterLightOverflowRow,
                                         masterRight: lOvfRight } });
            }
        }
    } else if (configType === "6") {
        // Мини: 2 базовых страницы + 3я при 25+ учениках
        //
        // Правило по таблице:
        //   ≤24 учеников:  2 базовых сетки (нет overflow)
        //   25–28 учеников: 2 базовых + N-Overflow-Row (1–4 уч. + classPhotoFrame)
        //   29–36 учеников: 3 обычных сетки (3я сетка неполная, пустые слоты скрываются)
        var nGrid = getMiniGrid(students.length);
        var nBasePages = 2;
        var nMaxOnBase = nBasePages * nGrid.slotsPerPage;
        var nOverflow = students.length - nMaxOnBase;
        // N-Overflow-Row вмещает max 4 портрета (по метке studentPortrait_1..4)
        var nOverflowIsRow = (nOverflow > 0 && nOverflow <= 4);
        var nOverflowIsGrid = (nOverflow > 4);  // 5–12: 3я обычная сетка
        var nHasOverflow = nOverflowIsRow && masterMiniOverflowRow;
        var nTotalStudentPages = nBasePages + ((nOverflowIsRow || nOverflowIsGrid) ? 1 : 0);

        report.push("Мини: " + students.length + " учеников, сетка " + nGrid.cols + "x" + nGrid.rows +
                    " (" + nGrid.slotsPerPage + " на стр.), " + nTotalStudentPages + " страниц" +
                    (nOverflowIsRow  ? " (overflow: " + nOverflow + " уч. → N-Overflow-Row)" :
                     nOverflowIsGrid ? " (3я сетка: " + nOverflow + " уч. → N-" + nGrid.suffix + ")" : ""));
        if (!miniMastersLeft[nGrid.suffix] || !miniMastersRight[nGrid.suffix]) {
            report.push("[WARN] Мастера N-" + nGrid.suffix + "-Left / N-" + nGrid.suffix + "-Right не найдены");
            totalWarnings++;
        }
        for (var np = 0; np < nBasePages; np++) {
            var nSlice = students.slice(np * nGrid.slotsPerPage, (np + 1) * nGrid.slotsPerPage);
            pageQueue.push({ master: null, role: "studentGrid",
                             data: { students: nSlice, slotsPerPage: nGrid.slotsPerPage, hasQuote: false,
                                     masterLeft: miniMastersLeft[nGrid.suffix],
                                     masterRight: miniMastersRight[nGrid.suffix] } });
        }
        if (nHasOverflow) {
            // 25–28: N-Overflow-Row с classPhotoFrame
            var nOverflowSlice = students.slice(nMaxOnBase);
            pageQueue.push({ master: null, role: "overflowRow",
                             data: { students: nOverflowSlice, slotsPerPage: nGrid.slotsPerPage,
                                     masterLeft: masterMiniOverflowRow,
                                     masterRight: miniMastersRight[nGrid.suffix] } });
        } else if (nOverflowIsGrid) {
            // 29–36: 3я обычная страница сетки (неполная, пустые слоты скроются)
            var n3Slice = students.slice(nMaxOnBase);
            pageQueue.push({ master: null, role: "studentGrid",
                             data: { students: n3Slice, slotsPerPage: nGrid.slotsPerPage, hasQuote: false,
                                     masterLeft: miniMastersLeft[nGrid.suffix],
                                     masterRight: miniMastersRight[nGrid.suffix] } });
        }
    } else if (configType === "7") {
        // Индивидуальный:
        //   1) Личный раздел: E-Max-Left + E-Max-Right на каждого ученика
        //   2) Сетка-миниатюры: та же логика что Мини (N-12)
        //   3) Общий раздел: как у Мини

        // ─ Личный раздел ─
        for (var is = 0; is < students.length; is++) {
            // Правый мастер выбирается по числу фото с друзьями:
            // ≤3 фото → E-Ind-Right-3 (если найден), иначе E-Max-Right
            // 4 фото  → E-Max-Right (4 слота)
            var isFriendCount  = students[is].friendPhotos ? students[is].friendPhotos.length : 0;
            var isRightMaster  = (isFriendCount <= 3 && masterIndRight3) ? masterIndRight3 : masterMaxRight;
            pageQueue.push({ master: masterMaxLeft,   role: "studentMaxLeft",  data: students[is] });
            pageQueue.push({ master: isRightMaster,   role: "studentMaxRight", data: students[is] });
        }

        // ─ Сетка-миниатюры (та же логика что configType "6") ─
        var inGrid = getMiniGrid(students.length);
        var inBasePages = 2;
        var inMaxOnBase = inBasePages * inGrid.slotsPerPage;
        var inOverflow  = students.length - inMaxOnBase;
        var inOvfIsRow  = (inOverflow > 0 && inOverflow <= 4);
        var inOvfIsGrid = (inOverflow > 4);
        var inHasOvf    = inOvfIsRow && masterMiniOverflowRow;
        var inTotalGrid = inBasePages + ((inOvfIsRow || inOvfIsGrid) ? 1 : 0);

        report.push("Индивидуальный: " + students.length + " учеников" +
                    " | личных страниц: " + (students.length * 2) +
                    " | сетка " + inGrid.cols + "x" + inGrid.rows +
                    " (" + inTotalGrid + " стр.)");
        if (!miniMastersLeft[inGrid.suffix] || !miniMastersRight[inGrid.suffix]) {
            report.push("[WARN] Мастера N-" + inGrid.suffix + "-Left / N-" + inGrid.suffix + "-Right не найдены");
            totalWarnings++;
        }
        for (var inp = 0; inp < inBasePages; inp++) {
            var inSlice = students.slice(inp * inGrid.slotsPerPage, (inp + 1) * inGrid.slotsPerPage);
            pageQueue.push({ master: null, role: "studentGrid",
                             data: { students: inSlice, slotsPerPage: inGrid.slotsPerPage, hasQuote: false,
                                     masterLeft: miniMastersLeft[inGrid.suffix],
                                     masterRight: miniMastersRight[inGrid.suffix] } });
        }
        if (inHasOvf) {
            var inOvfSlice = students.slice(inMaxOnBase);
            pageQueue.push({ master: null, role: "overflowRow",
                             data: { students: inOvfSlice, slotsPerPage: inGrid.slotsPerPage,
                                     masterLeft: masterMiniOverflowRow,
                                     masterRight: miniMastersRight[inGrid.suffix] } });
        } else if (inOvfIsGrid) {
            var in3Slice = students.slice(inMaxOnBase);
            pageQueue.push({ master: null, role: "studentGrid",
                             data: { students: in3Slice, slotsPerPage: inGrid.slotsPerPage, hasQuote: false,
                                     masterLeft: miniMastersLeft[inGrid.suffix],
                                     masterRight: miniMastersRight[inGrid.suffix] } });
        }
    }

    // --- Добавляем страницы учеников (зарезервированные уже есть) ---
    while (doc.pages.length < pageQueue.length) {
        doc.pages.add(LocationOptions.AT_END);
    }

    // --- studentPageCount и oddStudents вычисляем ЗДЕСЬ ---
    // Нужно ДО blank-padding (Мини), чтобы знать будет ли jHalf в common.
    var studentPageCount;
    if (configType === "1" || configType === "2") {
        studentPageCount = students.length;
    } else if (configType === "3") {
        studentPageCount = students.length * 2;
    } else if (configType === "4") {
        studentPageCount = Math.ceil(students.length / 4);
    } else if (configType === "5") {
        var lGridOdd = getLightGrid(students.length);
        var lMaxOdd  = 4 * lGridOdd.slotsPerPage;
        studentPageCount = 4 + (students.length > lMaxOdd ? 1 : 0);
    } else if (configType === "6") {
        var nGridOdd = getMiniGrid(students.length);
        var nBaseOdd = 2;
        var nMaxBaseOdd = nBaseOdd * nGridOdd.slotsPerPage;
        var nOvfOdd = students.length - nMaxBaseOdd;
        // 3я страница (overflow-row ИЛИ 3я сетка) считается как 1 дополнительная
        studentPageCount = nBaseOdd + (nOvfOdd > 0 ? 1 : 0);
    } else if (configType === "7") {
        // Индивидуальный: личные (2 на уч.) + сетка-миниатюры (как мини)
        var inGridOdd = getMiniGrid(students.length);
        var inBaseOdd = 2;
        var inMaxBaseOdd = inBaseOdd * inGridOdd.slotsPerPage;
        var inOvfOdd = students.length - inMaxBaseOdd;
        var gridPagesOdd = inBaseOdd + (inOvfOdd > 0 ? 1 : 0);
        studentPageCount = students.length * 2 + gridPagesOdd;
    } else {
        studentPageCount = students.length;
    }
    var oddStudents = (studentPageCount % 2 !== 0);

    // Мини: минимальное число страниц достигается через common раздел автоматически.
    // Blank-padding убран — он вставлял пустую страницу между overflow и flex_C,
    // разрывая правильный разворот (overflow=LEFT + flex_C=RIGHT).
    if (configType === "6") {
        report.push("[INFO] Мини: личных страниц = " + pageQueue.length +
                    (oddStudents ? " (нечётное, flex_C займёт правую)" : ""));
    }

    // --- Общий раздел (после личных страниц) ---

    // Предварительно распределяем фото class_full/ по позициям.
    // Делается ДО построения commonPages — порядок важен!
    // Приоритет: вступление > учителя > overflow-страница > нечётный ученик > финал
    var fcPool = photos.fullClass;
    var fcI    = 0;

    // F-Head-WithPhoto (headonly, grid_9, grid_12, grid_16) имеет classPhotoFrame
    // F-Head-SmallGrid и F-Head-LargeGrid (small, large_small) — НЕ имеют
    var needTeacherPhoto = (scenario === "headonly" || scenario === "grid_9" ||
                            scenario === "grid_12"  || scenario === "grid_16");

    // Есть ли overflow-страница с classPhotoFrame (Лайт/Мини)?
    // Мини: только 25–28 (N-Overflow-Row с classPhotoFrame). 29–36 — обычная 3я сетка, нет classPhotoFrame.
    var overflowNeedsPhoto = false;
    if (configType === "5") {
        var lgOvfTmp = getLightGrid(students.length);
        var lgOvf2 = students.length - 4 * lgOvfTmp.slotsPerPage;
        // L-Overflow-Row (classPhotoFrame) нужна при 25-27 и 31-32
        overflowNeedsPhoto = (lgOvf2 > 0 && lgOvf2 <= 3) || (lgOvf2 > 6);
    } else if (configType === "6") {
        var mgOvfTmp = getMiniGrid(students.length);
        var mgOverflow = students.length - 2 * mgOvfTmp.slotsPerPage;
        overflowNeedsPhoto = (mgOverflow > 0 && mgOverflow <= 4);
    }

    // hasOverflowRight: overflow-страница находится на ПРАВОЙ стороне разворота
    // = чётное кол-во страниц ученик + есть overflow (oddStudents=false + overflow)
    // Влияет на структуру общего раздела в мягких листах (4 обяз. стр. вместо 6).
    var hasOverflowRight = false;
    if (!oddStudents && overflowNeedsPhoto && configType === "5") {
        // Лайт: если overflow есть и страниц чётное кол-во — overflow на правой
        hasOverflowRight = true;
    } else if (!oddStudents && configType === "4") {
        // Медиум: 13-14, 21-22, 29-30 учеников (n % 8 == 5 или 6)
        var nMod8 = students.length % 8;
        hasOverflowRight = (nMod8 === 5 || nMod8 === 6);
    }

    // 1) Вступление — только мягкие листы кроме Мини (isMiniSoft не имеет S-Intro)
    var preIntroPhoto    = (!isLayflat && !isMiniSoft && fcI < fcPool.length) ? fcPool[fcI++] : null;
    // 2) Учительская страница classPhotoFrame
    var preTeacherPhoto  = (needTeacherPhoto    && fcI < fcPool.length) ? fcPool[fcI++] : null;
    // 3) Overflow-страница classPhotoFrame (Лайт/Мини)
    var preOverflowPhoto = (overflowNeedsPhoto  && fcI < fcPool.length) ? fcPool[fcI++] : null;
    // 4) Правая нечётная страница (flex_C fallback если нет half/collage)
    var preOddPhoto      = (oddStudents         && fcI < fcPool.length) ? fcPool[fcI++] : null;
    // 5) Финальные страницы общего раздела (FULL-слоты в mandatory/additional)
    var preFinalPhoto    = (fcI < fcPool.length) ? fcPool[fcI++] : null;
    var preFinalPhoto2   = (fcI < fcPool.length) ? fcPool[fcI++] : null; // доп. резерв
    var preFinalPhoto3   = (fcI < fcPool.length) ? fcPool[fcI++] : null; // доп. резерв

    report.push("Фото класса распределены: " + fcPool.length + " шт." +
        (preIntroPhoto    ? " | вступление"    : "") +
        (preTeacherPhoto  ? " | учителя"       : "") +
        (preOverflowPhoto ? " | overflow"      : "") +
        (preOddPhoto      ? " | нечётная стр." : "") +
        (preFinalPhoto    ? " | финал"         : "") +
        (hasOverflowRight ? " [overflow=RIGHT]" : ""));

    var commonPages = [];
    if (hasCommonSection) {
        var commonFolder = new Folder(commonBase + "/common");
        if (commonFolder.exists) {

            // ============================================================
            // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
            // ============================================================

            // Взять count фото из папки key
            function takePhotos(key, count) {
                var r = [];
                for (var ti = 0; ti < count; ti++) {
                    if (photoIdx[key] < photos[key].length) { r.push(photos[key][photoIdx[key]++]); }
                }
                return r;
            }

            // Вычислить сторону страницы (isRight) по индексу в commonPages
            // Первая common страница — RIGHT если pageQueue.length чётный
            function commonIsRight(idx) {
                var firstRight = (pageQueue.length % 2 === 0);
                return firstRight ? (idx % 2 === 0) : (idx % 2 !== 0);
            }

            // nextFinalPhoto: берёт следующий pre-allocated fullClass-снимок
            // из последовательности preFinalPhoto → preFinalPhoto2 → preFinalPhoto3 → пул
            function nextFinalPhoto() {
                if (preFinalPhoto)  { var p = preFinalPhoto;  preFinalPhoto  = null; return p; }
                if (preFinalPhoto2) { var p = preFinalPhoto2; preFinalPhoto2 = null; return p; }
                if (preFinalPhoto3) { var p = preFinalPhoto3; preFinalPhoto3 = null; return p; }
                if (photoIdx.fullClass < photos.fullClass.length) {
                    return photos.fullClass[photoIdx.fullClass++];
                }
                return null;
            }

            // Добавить одну страницу общего раздела.
            // slotType: "H" | "Q" | "FULL" | "flex_A" | "flex_B" | "flex_C"
            // isRight: правая страница разворота
            // oddFb: фото для FULL-слота в flex_C (preOddPhoto)
            // Возвращает true если страница добавлена
            function pushCommonSlot(slotType, isRight, oddFb) {
                var tryList = [];

                if (slotType === "H") {
                    tryList = [["half", 2, masterHalf, "jHalf"]];

                } else if (slotType === "Q") {
                    tryList = [["quarter", 2, masterQuarter, "jQuarter"]];

                } else if (slotType === "FULL") {
                    var mFu = isRight ? masterJClassPhotoR : masterJClassPhoto;
                    var rFu = isRight ? "jClassPhotoRight" : "jClassPhoto";
                    tryList = [["full", 1, mFu, rFu]];

                } else if (slotType === "flex_A") {
                    // collage(6) > half(2) > full(1)
                    var mA = isRight ? masterJClassPhotoR : masterJClassPhoto;
                    var rA = isRight ? "jClassPhotoRight" : "jClassPhoto";
                    tryList = [
                        ["collage", 6, masterCollage, "jCollage"],
                        ["half",    2, masterHalf,    "jHalf"],
                        ["full",    1, mA, rA]
                    ];

                } else if (slotType === "flex_B") {
                    // quarter(2) > collage(6) > half(2) > full(1)
                    var mB = isRight ? masterJClassPhotoR : masterJClassPhoto;
                    var rB = isRight ? "jClassPhotoRight" : "jClassPhoto";
                    tryList = [
                        ["quarter", 2, masterQuarter, "jQuarter"],
                        ["collage", 6, masterCollage, "jCollage"],
                        ["half",    2, masterHalf,    "jHalf"],
                        ["full",    1, mB, rB]
                    ];

                } else if (slotType === "flex_C") {
                    // half(2) > collage(6) > full(1) — всегда правая страница
                    tryList = [
                        ["half",    2, masterHalf,        "jHalf"],
                        ["collage", 6, masterCollage,     "jCollage"],
                        ["full",    1, masterJClassPhotoR,"jClassPhotoRight"]
                    ];
                }

                for (var ti2 = 0; ti2 < tryList.length; ti2++) {
                    var typ2 = tryList[ti2][0];
                    var cnt2 = tryList[ti2][1];
                    var mst2 = tryList[ti2][2];
                    var rol2 = tryList[ti2][3];

                    if (!mst2) continue;

                    if (typ2 === "full") {
                        // FULL-слот: сначала oddFb (для flex_C), потом preFinalPhoto*/пул
                        var fph = null;
                        if (slotType === "flex_C" && oddFb) {
                            fph = oddFb;
                            if (fph === preOddPhoto) { preOddPhoto = null; }
                        } else {
                            fph = nextFinalPhoto();
                        }
                        if (fph) {
                            commonPages.push({ master: mst2, role: rol2, data: { files: [fph] } });
                            return true;
                        }
                    } else {
                        if (photoIdx[typ2] + cnt2 <= photos[typ2].length) {
                            var pf2 = takePhotos(typ2, cnt2);
                            commonPages.push({ master: mst2, role: rol2, data: { files: pf2 } });
                            return true;
                        }
                    }
                }
                return false;
            }

            // ============================================================
            // ШАГ 1: Нечётная страница (flex_C)
            // Правая сторона разворота при нечётном кол-ве страниц личного раздела.
            // Приоритет: 2 по 1/2 класса → 6 фото 1/6 → 1 общая
            // ============================================================
            if (oddStudents) {
                if (pushCommonSlot("flex_C", true, preOddPhoto)) {
                    report.push("[INFO] Нечётная стр.: добавлена (half/collage/classPhoto)");
                } else {
                    report.push("[WARN] Нечётная стр.: нет фото для правой страницы");
                    totalWarnings++;
                }
            }

            // ============================================================
            // ШАГ 2: Состав обязательного и дополнительного разделов
            // По таблице «Структура альбомов для автовёрстки — Общий раздел»
            // ============================================================
            var mandSlots2 = [];
            var addSlots2  = [];

            if (configType === "6") {
                // ─── МИНИ ───
                if (students.length <= 24) {
                    if (isLayflat) {
                        mandSlots2 = ["H", "flex_A"];
                        addSlots2  = ["flex_A", "flex_A", "flex_B", "flex_B"];
                    } else {
                        mandSlots2 = ["H", "flex_A", "FULL"];
                        addSlots2  = ["flex_A", "flex_B", "flex_B", "flex_A"];
                    }
                } else {
                    if (!isLayflat) { mandSlots2 = ["H"]; }
                    addSlots2 = ["flex_A", "flex_A", "flex_B", "flex_B"];
                }

            } else if (configType === "7") {
                // ─── ИНДИВИДУАЛЬНЫЙ ───
                // Общий раздел — стандартный (как у Мини ≤24),
                // независимо от числа учеников (сетка уже в личном разделе).
                if (isLayflat) {
                    mandSlots2 = ["H", "flex_A"];
                    addSlots2  = ["flex_A", "flex_A", "flex_B", "flex_B"];
                } else {
                    mandSlots2 = ["H", "flex_A", "FULL"];
                    addSlots2  = ["flex_A", "flex_B", "flex_B", "flex_A"];
                }

            } else {
                // ─── Лайт / Медиум / Стандарт / Универсал / Максимум ───
                if (oddStudents) {
                    // Нечётное кол-во страниц: обяз=4 (flex_C занял правую), доп=4
                    mandSlots2 = ["Q", "Q", "H", "flex_A"];
                    addSlots2  = ["flex_A", "flex_A", "flex_B", "flex_B"];
                } else if (hasOverflowRight && !isLayflat) {
                    // Чётное + overflow-right на мягких: обяз=4, доп=4
                    mandSlots2 = ["Q", "Q", "H", "flex_A"];
                    addSlots2  = ["flex_A", "flex_A", "flex_B", "flex_B"];
                } else {
                    // Чётное без overflow, или Layflat с overflow: обяз=6, доп=4
                    // Доп. раздел начинается с flex_A (не H) — H уже потрачен в обязательном
                    mandSlots2 = ["Q", "Q", "H", "flex_A", "flex_A", "flex_A"];
                    addSlots2  = ["flex_A", "flex_A", "flex_B", "flex_B"];
                }
            }

            // ============================================================
            // ШАГ 3: Обязательный раздел
            // ============================================================
            for (var ms2 = 0; ms2 < mandSlots2.length; ms2++) {
                pushCommonSlot(mandSlots2[ms2], commonIsRight(commonPages.length), null);
            }

            // ============================================================
            // ШАГ 4: Дополнительный раздел (пока есть фото)
            // ============================================================
            for (var as2 = 0; as2 < addSlots2.length; as2++) {
                var slotAdded = pushCommonSlot(addSlots2[as2], commonIsRight(commonPages.length), null);
                if (!slotAdded) break; // нет фото — останавливаемся
            }

        } // commonFolder.exists
    } // hasCommonSection

    // Мини: информационная строка в отчёт
    if (configType === "6") {
        report.push("[INFO] Мини: страниц личных=" + pageQueue.length +
                    " + common=" + commonPages.length +
                    " = итого " + (pageQueue.length + commonPages.length));
    }

    // Для мягких листов: убираем/добавляем стр. общего раздела если итог нечётный.
    // Для Layflat (плотных):  итог должен быть НЕЧЁТНЫМ (альбом заканчивается правой страницей).
    // pageQueue.length уже учитывает miniBlank-заполнители.
    if (isLayflat) {
        // Убираем последнюю common-страницу если сумма чётная
        var lTot = pageQueue.length + commonPages.length;
        if (lTot % 2 === 0 && commonPages.length > 0) {
            var removedLf = commonPages.pop();
            report.push("[INFO] Layflat: убрана последняя стр. общего раздела (" +
                        removedLf.role + ") — итог стал нечётным (" +
                        (pageQueue.length + commonPages.length) + ")");
        }
        // Если после обрезки всё равно чётный (common был 0) — добавляем пустую
        lTot = pageQueue.length + commonPages.length;
        if (lTot % 2 === 0) {
            commonPages.push({ master: null, role: "blankRight", data: null });
            report.push("[INFO] Layflat: добавлена пустая последняя стр. — итог нечётный (" +
                        (pageQueue.length + commonPages.length) + ")");
        }
    } else {
        var totalWithCommon = pageQueue.length + commonPages.length;
        if (totalWithCommon % 2 !== 0 && commonPages.length > 0) {
            var removedPage = commonPages.pop();
            report.push("[INFO] Мягкие листы: убрана последняя стр. общего раздела (" +
                        removedPage.role + ") — итог стал чётным");
        }
    }

    // Добавляем страницы общего раздела в очередь и в документ
    for (var cp = 0; cp < commonPages.length; cp++) {
        pageQueue.push(commonPages[cp]);
        doc.pages.add(LocationOptions.AT_END);
    }

    // Структуру первого разворота НЕ трогаем — она сохранена в шаблоне.
    // Скрипт только добавляет/удаляет страницы с конца документа.

    // На современных машинах перерисовка не замедляет работу заметно.
    // Оставляем включённой — оператор видит процесс в реальном времени.
    app.scriptPreferences.enableRedraw = true;

    // --- Применяем мастера и заполняем ---
    report.push("=========================================");
    report.push("СТРАНИЦЫ АЛЬБОМА");
    report.push("=========================================");

    var totalPages = pageQueue.length;

    for (var p = 0; p < pageQueue.length; p++) {
        var page = doc.pages[p];
        var item = pageQueue[p];
        var pageNum = p + 1;

        // --- Статусная строка ---
        try {
            var statusLabel = "";
            if      (item.role === "intro")        statusLabel = "Вступление";
            else if (item.role === "headTeacher")  statusLabel = "Классрук";
            else if (item.role === "teachersGrid") statusLabel = "Учителя";
            else if (item.role === "student")      statusLabel = item.data.name;
            app.statusBar.update(
                "Автовёрстка: стр." + pageNum + "/" + totalPages + "  |  " + statusLabel
            );
        } catch(e) {}

        // Очищаем старые оверрайды от предыдущих запусков (предотвращает накопление)
        clearOverrides(page);

        // Применяем мастер для всех страниц включая учительские.
        if (item.master) {
            try { page.appliedMaster = item.master; } catch(e) {}
        }

        // ── Фон разворота ──
        // Вставляется на нижний слой «Фон» до заполнения контента.
        // Категория определяется по роли страницы.
        // Фон вставляется только на ЛЕВУЮ страницу разворота (или на единственную),
        // чтобы не дублировать фрейм на каждой из двух страниц.
        if (hasBg) {
            var isLeftOrSingle = false;
            var isSingleBg = false;
            try {
                var pageSide = page.side;
                isLeftOrSingle = (pageSide === PageSideOptions.LEFT_HAND) ||
                                 (page.parent && page.parent.pages.length === 1);
                isSingleBg = (page.parent && page.parent.pages.length === 1);
            } catch(e) { isLeftOrSingle = true; }

            if (isLeftOrSingle) {
                var bgCat = null;
                if (item.role === "intro") {
                    // Мягкие: S-Intro получает фон вступления
                    // Layflat: страница 1 пустая (заполняется вручную) — фон не нужен
                    bgCat = isLayflat ? null : "intro";
                    isSingleBg = !isLayflat;
                } else if (item.role === "teacherLeft" || item.role === "teachersGrid" ||
                           item.role === "halfClass") {
                    bgCat = "teachers";
                } else if (item.role === "studentGrid" || item.role === "overflowRow") {
                    bgCat = "vignette";
                } else if (item.role === "student" || item.role === "studentMaxLeft" ||
                           item.role === "studentMaxRight" || item.role === "studentMediumLeft" ||
                           item.role === "studentMediumLast") {
                    bgCat = "personal";
                } else if (item.role === "jHalf" || item.role === "jQuarter" ||
                           item.role === "jCollage" || item.role === "jClassPhoto" ||
                           item.role === "jClassPhotoRight" || item.role === "jHalfSixth" ||
                           item.role === "jSixthFull" || item.role === "jSixthSixth") {
                    bgCat = "common";
                }
                if (bgCat && item.role !== "blankRight") applyBackground(bgCat, page, isSingleBg);
            }
        }

        // Заполняем в зависимости от роли
        if (item.role === "intro") {
            if (!isLayflat && masterIntro) {
                // ТРЮК С ВРЕМЕННЫМ РАЗВОРОТОМ:
                // Пока страница 1 одиночная, её coordinate system в gutter-режиме,
                // и элементы мастера оказываются за левым краем (x < 0).
                // Добавляем временную LEFT-страницу ПЕРЕД стр.1 → она становится
                // полноценной RIGHT в развороте → после override удаляем temp-страницу.
                var introTempPage = null;
                try { introTempPage = doc.pages.add(LocationOptions.BEFORE, page); } catch(e) {}
                try { page.appliedMaster = masterIntro; } catch(e) {}
                overrideMaster(page);
                var introItems = snapshotItems(page);
                var introByLabel = {};
                for (var iit = 0; iit < introItems.length; iit++) {
                    var iil; try { iil = introItems[iit].label; } catch(e) { continue; }
                    if (iil && iil !== "" && !introByLabel[iil]) introByLabel[iil] = introItems[iit];
                }
                var introCpf = introByLabel["classPhotoFrame"];
                if (introCpf && preIntroPhoto) {
                    placeImage(introCpf, preIntroPhoto);
                    report.push("[OK]   Стр." + padNum(pageNum, 2) + " | Вступление S-Intro | classPhotoFrame: OK");
                } else {
                    report.push("[WARN] Стр." + padNum(pageNum, 2) + " | Вступление S-Intro | " +
                        (!introCpf ? "classPhotoFrame не найден в мастере" : "нет фото для classPhotoFrame"));
                    totalWarnings++;
                }
                if (introTempPage) { try { introTempPage.remove(); } catch(e) {} }
            } else if (!isLayflat) {
                report.push("[WARN] Стр." + padNum(pageNum, 2) + " | Вступление: мастер S-Intro не найден — заполните вручную");
                totalWarnings++;
            } else {
                try { page.appliedMaster = NothingEnum.nothing; } catch(e) {}
                report.push("[OK]   Стр." + padNum(pageNum, 2) + " | Вступление Layflat (заполняется вручную)");
            }

        } else if (item.role === "teacherLeft") {
            var tlHead = item.data ? item.data.head : null;
            if (!tlHead) {
                report.push("[WARN] Стр." + padNum(pageNum, 2) + " | Классрук не найден в CSV");
                totalWarnings++;
            } else if (scenario === "small" || scenario === "large_small") {
                // isMiniSoft: стр.1 одиночная → тот же трюк с временным разворотом
                var slTempPage = null;
                if (isMiniSoft) {
                    try { slTempPage = doc.pages.add(LocationOptions.BEFORE, page); } catch(e) {}
                }
                var maxSideSlots = (scenario === "large_small") ? 8 : 4;
                var slRes = fillSideTeachersPage(page, tlHead, item.data.sideTeachers || [], maxSideSlots,
                                                 idx, photos, photoIdx, preTeacherPhoto);
                if (slTempPage) { try { slTempPage.remove(); } catch(e) {} }
                totalErrors += slRes.errors; totalWarnings += slRes.warnings;
                report.push((slRes.errors>0?"[ERR] ":slRes.warnings>0?"[WARN]":"[OK]  ") +
                    " Стр." + padNum(pageNum, 2) + " | Классрук+" + maxSideSlots + "предм | " + slRes.summary);
            } else {
                var hTempPage = null;
                if (isMiniSoft) {
                    try { hTempPage = doc.pages.add(LocationOptions.BEFORE, page); } catch(e) {}
                }
                var hRes = fillHeadWithPhotoPage(page, tlHead, item.data.sideTeachers || [],
                                                 scenario === "overflow" ? 8 : 0,
                                                 idx, photos, photoIdx, preTeacherPhoto);
                if (hTempPage) { try { hTempPage.remove(); } catch(e) {} }
                totalErrors += hRes.errors; totalWarnings += hRes.warnings;
                report.push((hRes.errors>0?"[ERR] ":hRes.warnings>0?"[WARN]":"[OK]  ") +
                    " Стр." + padNum(pageNum, 2) + " | Классрук | " + tlHead.name + " | " + hRes.summary);
            }

        } else if (item.role === "teacherRight") {
            if (scenario === "headonly" || scenario === "small" || scenario === "large_small") {
                // Правая страница зависит от наличия фото: G-HalfClass / G-FullClass / пусто
                if (!masterRight) {
                    overrideMaster(page); // просто переопределяем чтобы фрейм был кликабелен
                    report.push("[OK]   Стр." + padNum(pageNum, 2) + " | Правая страница учителей (нет фото в common/)");
                } else if (masterRight === masterGHalfClass) {
                    var hrRes = fillHalfClassPage(page, photos, photoIdx);
                    totalErrors += hrRes.errors; totalWarnings += hrRes.warnings;
                    report.push((hrRes.errors>0?"[ERR] ":hrRes.warnings>0?"[WARN]":"[OK]  ") +
                        " Стр." + padNum(pageNum, 2) + " | G-HalfClass | " + hrRes.summary);
                } else if (masterRight === masterGFullClass) {
                    overrideMaster(page);
                    var fcItems = snapshotItems(page);
                    var fcByLabel = {};
                    for (var fci=0; fci<fcItems.length; fci++) {
                        var fcl; try { fcl = fcItems[fci].label; } catch(e) { continue; }
                        if (fcl && fcl !== "" && !fcByLabel[fcl]) fcByLabel[fcl] = fcItems[fci];
                    }
                    var fcFrame = fcByLabel["classPhotoFrame"];
                    var fcPhoto = fcFrame ? (photos.fullClass.length > photoIdx.fullClass ?
                        photos.fullClass[photoIdx.fullClass++] : null) : null;
                    if (fcFrame && fcPhoto) {
                        placeImage(fcFrame, fcPhoto);
                        report.push("[OK]   Стр." + padNum(pageNum, 2) + " | G-FullClass | classPhotoFrame");
                    } else {
                        report.push("[WARN] Стр." + padNum(pageNum, 2) + " | G-FullClass | нет фото");
                        totalWarnings++;
                    }
                }
            } else if (item.data && item.data.teachers) {
                // G-Teachers-3x3 / 4x3 / 4x4
                var gRes = fillGridPageUniversal(page, item.data.teachers, item.data.maxSlots, false, idx);
                totalErrors += gRes.errors; totalWarnings += gRes.warnings;
                report.push("[----] Стр." + padNum(pageNum, 2) + " | Предметники (" +
                            item.data.teachers.length + "/" + item.data.maxSlots + "):");
                for (var gl = 0; gl < gRes.lines.length; gl++) {
                    report.push("       " + gRes.lines[gl]);
                }
            }

        } else if (item.role === "mediumLastLeft") {
            // D-Medium-Last-WithPhoto: 1-2 ученика + classPhotoFrame
            if (masterMediumLastPhoto) { try { page.appliedMaster = masterMediumLastPhoto; } catch(e) {} }
            overrideMaster(page);
            var mlItems = snapshotItems(page);
            var mlByLabel = {};
            for (var mli=0; mli<mlItems.length; mli++) {
                var mll; try { mll = mlItems[mli].label; } catch(e) { continue; }
                if (mll && mll !== "" && !mlByLabel[mll]) mlByLabel[mll] = mlItems[mli];
            }
            var mlStudents = item.data.students;
            for (var mls=0; mls<mlStudents.length; mls++) {
                var n = mls + 1;
                fillByLabel(mlByLabel, "studentName_" + n, mlStudents[mls].name, [], {errors:0,warnings:0});
                fillByLabel(mlByLabel, "studentQuote_" + n, mlStudents[mls].quote, [], {errors:0,warnings:0});
                fillPhotoByLabel(mlByLabel, "studentPortrait_" + n, mlStudents[mls].portrait, idx, [], {errors:0,warnings:0});
            }
            // Скрываем пустые слоты
            for (var mls2=mlStudents.length+1; mls2<=2; mls2++) {
                hideByLabel(mlByLabel, "studentPortrait_" + mls2);
                hideByLabel(mlByLabel, "studentName_" + mls2);
                hideByLabel(mlByLabel, "studentQuote_" + mls2);
            }
            // classPhotoFrame из preFinalPhoto
            var mlCpf = mlByLabel["classPhotoFrame"];
            if (mlCpf && preFinalPhoto) { placeImage(mlCpf, preFinalPhoto); preFinalPhoto = null; }
            report.push("[OK]   Стр." + padNum(pageNum, 2) + " | Медиум Last | " +
                (function(arr){var r=[];for(var i=0;i<arr.length;i++)r.push(arr[i].name);return r.join(", ");})(mlStudents));

        } else if (item.role === "mediumLastRight") {
            // Правая страница после D-Medium-Last: G-HalfClass или G-FullClass
            var mlrMaster = (photos.half.length > photoIdx.half + 1) ? masterGHalfClass : masterGFullClass;
            if (mlrMaster) { try { page.appliedMaster = mlrMaster; } catch(e) {} }
            if (mlrMaster === masterGHalfClass) {
                var mlrRes = fillHalfClassPage(page, photos, photoIdx);
                report.push("[OK]   Стр." + padNum(pageNum, 2) + " | Медиум Last Right | HalfClass | " + mlrRes.summary);
            } else if (mlrMaster === masterGFullClass) {
                overrideMaster(page);
                var mlrItems = snapshotItems(page);
                var mlrByLabel = {};
                for (var mi=0; mi<mlrItems.length; mi++) {
                    var ml2; try { ml2 = mlrItems[mi].label; } catch(e) { continue; }
                    if (ml2 && ml2 !== "" && !mlrByLabel[ml2]) mlrByLabel[ml2] = mlrItems[mi];
                }
                var mlrCpf = mlrByLabel["classPhotoFrame"];
                var mlrPhoto = mlrCpf ? (photos.fullClass.length > photoIdx.fullClass ?
                    photos.fullClass[photoIdx.fullClass++] : null) : null;
                if (mlrCpf && mlrPhoto) { placeImage(mlrCpf, mlrPhoto); }
                report.push("[OK]   Стр." + padNum(pageNum, 2) + " | Медиум Last Right | FullClass");
            } else {
                report.push("[WARN] Стр." + padNum(pageNum, 2) + " | Медиум Last Right | нет фото");
                totalWarnings++;
            }

        } else if (item.role === "overflowRow") {
            // Overflow страница: строка портретов + classPhotoFrame снизу (Лайт/Мини)
            var orMasterL = item.data.masterLeft;
            var isLeftOr = false;
            try { isLeftOr = (page.side === PageSideOptions.LEFT_HAND); } catch(e) {}
            var orMaster = isLeftOr ? orMasterL : item.data.masterRight;
            if (orMaster) { try { page.appliedMaster = orMaster; } catch(e) {} }
            overrideMaster(page);
            var orItems = snapshotItems(page);
            var orByLabel = {};
            for (var ori=0; ori<orItems.length; ori++) {
                var orl; try { orl = orItems[ori].label; } catch(e) { continue; }
                if (orl && orl !== "" && !orByLabel[orl]) orByLabel[orl] = orItems[ori];
            }
            // Заполняем портреты
            var orStudents = item.data.students;
            for (var ors=0; ors<orStudents.length; ors++) {
                var orn = ors + 1;
                fillByLabel(orByLabel, "studentName_" + orn, orStudents[ors].name, [], {errors:0,warnings:0});
                fillPhotoByLabel(orByLabel, "studentPortrait_" + orn, orStudents[ors].portrait, idx, [], {errors:0,warnings:0});
            }
            // Скрываем пустые слоты — берём max из обоих overflow мастеров (N=4, L=3)
            var orMaxSlots = 4;
            for (var ors2=orStudents.length+1; ors2<=orMaxSlots; ors2++) {
                hideByLabel(orByLabel, "studentPortrait_" + ors2);
                hideByLabel(orByLabel, "studentName_"    + ors2);
            }
            // classPhotoFrame — из preOverflowPhoto, затем preFinalPhoto, затем из пула
            var orCpf = orByLabel["classPhotoFrame"];
            if (orCpf) {
                var orPhoto = preOverflowPhoto;
                if (orPhoto) { preOverflowPhoto = null; }
                if (!orPhoto) { orPhoto = preFinalPhoto; if (orPhoto) { preFinalPhoto = null; } }
                if (!orPhoto && photos.fullClass.length > photoIdx.fullClass) {
                    orPhoto = photos.fullClass[photoIdx.fullClass++];
                }
                if (orPhoto) { placeImage(orCpf, orPhoto); }
                else { report.push("[WARN] Стр." + padNum(pageNum,2) + " | Overflow: нет фото для classPhotoFrame"); totalWarnings++; }
            }
            report.push("[OK]   Стр." + padNum(pageNum, 2) + " | Overflow | " +
                (function(arr){var r=[];for(var i=0;i<arr.length;i++)r.push(arr[i].name);return r.join(", ");})(orStudents));

        } else if (item.role === "studentMaxLeft") {
            // Максимум — левая страница: портрет + имя + цитата
            if (masterMaxLeft) { try { page.appliedMaster = masterMaxLeft; } catch(e) {} }
            var smlRes = fillStudentPage(page, item.data, idx, "1", masterMaxLeft);
            totalErrors += smlRes.errors; totalWarnings += smlRes.warnings;
            report.push((smlRes.errors>0?"[ERR] ":smlRes.warnings>0?"[WARN]":"[OK]  ") +
                " Стр." + padNum(pageNum, 2) + " | Ученик L | " + item.data.name + " | " + smlRes.summary);

        } else if (item.role === "studentMaxRight") {
            // Максимум — правая страница: 4 фото с друзьями
            if (masterMaxRight) { try { page.appliedMaster = masterMaxRight; } catch(e) {} }
            var smrRes = fillStudentPage(page, item.data, idx, "3", masterMaxRight);
            totalErrors += smrRes.errors; totalWarnings += smrRes.warnings;
            report.push((smrRes.errors>0?"[ERR] ":smrRes.warnings>0?"[WARN]":"[OK]  ") +
                " Стр." + padNum(pageNum, 2) + " | Ученик R | " + item.data.name + " | " + smrRes.summary);

        } else if (item.role === "student") {
            // Стандарт / Универсал / Универсал-Left / Универсал-Right
            // Выбираем мастер по реальной стороне страницы (для Универсала)
            var theStudentMaster = activeStudentMaster;
            var needsPerPageMaster = (configType !== "1") && (
                (isMaximum && masterMaxLeft && masterMaxRight) ||
                (!isMaximum && masterStudentLeft && masterStudentRight)
            );
            if (needsPerPageMaster) {
                var isLeftStudentPage = false;
                try { isLeftStudentPage = (page.side === PageSideOptions.LEFT_HAND); } catch(e) {}
                if (isMaximum) {
                    theStudentMaster = isLeftStudentPage ? masterMaxLeft : masterMaxRight;
                } else {
                    theStudentMaster = isLeftStudentPage ? masterStudentLeft : masterStudentRight;
                }
                try { page.appliedMaster = theStudentMaster; } catch(e) {}
            }
            var sRes = fillStudentPage(page, item.data, idx, configType, theStudentMaster);
            totalErrors   += sRes.errors;
            totalWarnings += sRes.warnings;
            var sPfx = sRes.errors > 0 ? "[ERR] " : (sRes.warnings > 0 ? "[WARN]" : "[OK]  ");
            report.push(sPfx + " Стр." + padNum(pageNum, 2) + " | Ученик | " +
                        item.data.name + " | " + sRes.summary);

        } else if (item.role === "studentGrid") {
            // Сеточная комплектация: несколько учеников на странице (Медиум/Лайт/Мини)
            var isLeftGrid = false;
            try { isLeftGrid = (page.side === PageSideOptions.LEFT_HAND); } catch(e) {}
            var gridMaster = isLeftGrid ? item.data.masterLeft : item.data.masterRight;
            if (gridMaster) {
                try { page.appliedMaster = gridMaster; } catch(e) {}
            } else {
                report.push("[WARN] Стр." + padNum(pageNum, 2) + " | Мастер сетки не найден");
                totalWarnings++;
            }
            var grdRes = fillGridStudentPage(page, item.data.students, idx,
                                             item.data.slotsPerPage, item.data.hasQuote);
            totalErrors   += grdRes.errors;
            totalWarnings += grdRes.warnings;
            var grdPfx = grdRes.errors > 0 ? "[ERR] " : (grdRes.warnings > 0 ? "[WARN]" : "[OK]  ");
            report.push(grdPfx + " Стр." + padNum(pageNum, 2) +
                        " | Сетка (" + item.data.students.length + "/" + item.data.slotsPerPage + ") | " +
                        grdRes.summary);

        } else if (item.role === "miniBlank" || item.role === "blankRight") {
            // Пустая обязательная страница — снимаем мастер явно
            try { page.appliedMaster = NothingEnum.nothing; } catch(e) {}
            report.push("[OK]   Стр." + padNum(pageNum, 2) + " | Пустая страница (заполните вручную)");

        } else if (item.role === "jCollage" || item.role === "jQuarter" ||
                   item.role === "jHalf"    || item.role === "jClassPhoto" ||
                   item.role === "jClassPhotoRight") {
            var jRes = fillCommonPage(page, item.role, item.data.files);
            totalErrors   += jRes.errors;
            totalWarnings += jRes.warnings;
            var jPfx = jRes.errors > 0 ? "[ERR] " : (jRes.warnings > 0 ? "[WARN]" : "[OK]  ");
            report.push(jPfx + " Стр." + padNum(pageNum, 2) + " | " + item.role +
                        " | " + jRes.summary);

        } else if (item.role === "jHalfSixth") {
            // J-HalfSixth: 2-стр разворот — заполняем по меткам обеих страниц
            overrideMaster(page);
            var jhsItems = snapshotItems(page);
            var jhsByLabel = {};
            for (var ji=0; ji<jhsItems.length; ji++) {
                var jl; try { jl = jhsItems[ji].label; } catch(e) { continue; }
                if (jl && jl !== "" && !jhsByLabel[jl]) jhsByLabel[jl] = jhsItems[ji];
            }
            var jhsParts = [];
            // Полкласса — метки halfPhoto_1/2 (шаблон) или halfLeftPhoto/halfRightPhoto (fallback)
            var jhsHalf = item.data.halfFiles || [];
            var jhs1 = jhsByLabel["halfPhoto_1"] || jhsByLabel["halfLeftPhoto"];
            var jhs2 = jhsByLabel["halfPhoto_2"] || jhsByLabel["halfRightPhoto"];
            if (jhs1 && jhsHalf[0]) { placeImage(jhs1, jhsHalf[0]); jhsParts.push("halfPhoto_1"); }
            if (jhs2 && jhsHalf[1]) { placeImage(jhs2, jhsHalf[1]); jhsParts.push("halfPhoto_2"); }
            // Одна шестая
            var jhsColl = item.data.collageFiles || [];
            for (var jci=0; jci<jhsColl.length; jci++) {
                var jcl = "collagePhoto_" + (jci+1);
                if (jhsByLabel[jcl]) { placeImage(jhsByLabel[jcl], jhsColl[jci]); jhsParts.push(jcl); }
            }
            report.push("[OK]   Стр." + padNum(pageNum, 2) + " | jHalfSixth | " + jhsParts.join(", "));

        } else if (item.role === "jSixthFull") {
            // J-SixthFull: одна шестая + общее фото
            overrideMaster(page);
            var jsfItems = snapshotItems(page);
            var jsfByLabel = {};
            for (var jsfi=0; jsfi<jsfItems.length; jsfi++) {
                var jsfl; try { jsfl = jsfItems[jsfi].label; } catch(e) { continue; }
                if (jsfl && jsfl !== "" && !jsfByLabel[jsfl]) jsfByLabel[jsfl] = jsfItems[jsfi];
            }
            var jsfParts = [];
            var jsfColl = item.data.collageFiles || [];
            for (var jsfc=0; jsfc<jsfColl.length; jsfc++) {
                var jsflabel = "collagePhoto_" + (jsfc+1);
                if (jsfByLabel[jsflabel]) { placeImage(jsfByLabel[jsflabel], jsfColl[jsfc]); jsfParts.push(jsflabel); }
            }
            if (jsfByLabel["classPhotoFrame"] && item.data.fullPhoto) {
                placeImage(jsfByLabel["classPhotoFrame"], item.data.fullPhoto); jsfParts.push("classPhotoFrame");
            }
            report.push("[OK]   Стр." + padNum(pageNum, 2) + " | jSixthFull | " + jsfParts.join(", "));

        } else if (item.role === "jSixthSixth") {
            // J-SixthSixth: 12 фото одной шестой
            overrideMaster(page);
            var jssItems = snapshotItems(page);
            var jssByLabel = {};
            for (var jssi=0; jssi<jssItems.length; jssi++) {
                var jssl; try { jssl = jssItems[jssi].label; } catch(e) { continue; }
                if (jssl && jssl !== "" && !jssByLabel[jssl]) jssByLabel[jssl] = jssItems[jssi];
            }
            var jssParts = [];
            var jssColl = item.data.collageFiles || [];
            for (var jssc=0; jssc<jssColl.length; jssc++) {
                var jsslabel = "collagePhoto_" + (jssc+1);
                if (jssByLabel[jsslabel]) { placeImage(jssByLabel[jsslabel], jssColl[jssc]); jssParts.push(jsslabel); }
            }
            report.push("[OK]   Стр." + padNum(pageNum, 2) + " | jSixthSixth | " + jssParts.join(", "));
        }
    }

    report.push("");
    report.push("=========================================");
    report.push("ИТОГО");
    report.push("=========================================");
    report.push("Страниц в документе: " + doc.pages.length);
    report.push("Учеников: " + students.length);
    report.push("Предметников: " + subjects.length);
    report.push("Ошибок: " + totalErrors);
    report.push("Предупреждений: " + totalWarnings);
    report.push("");
    report.push("Фрейм classPhotoFrame оставлен пустым — вставьте фото вручную.");
    if (!isLayflat) {
        if (isMiniSoft) {
            report.push("Стр.1 (Мини мягкие): учительская F-страница (S-Intro не создаётся).");
        } else {
            report.push("Стр.1 (вступление) — " +
                (masterIntro ? "мастер S-Intro применён автоматически" :
                               "мастер S-Intro не найден в шаблоне — заполните вручную"));
        }
    }

    // Восстанавливаем перерисовку
    app.scriptPreferences.enableRedraw = true;

    saveReport(projectFolder, "build_report.txt", report);

    // Сбрасываем статусную строку
    try { app.statusBar.update(""); } catch(e) {}

    alert("СБОРКА ЗАВЕРШЕНА!" + CRLF + CRLF +
          "Страниц: " + doc.pages.length + CRLF +
          "Ошибок: " + totalErrors + CRLF +
          "Предупреждений: " + totalWarnings + CRLF + CRLF +
          "Отчёт: build_report.txt" + CRLF +
          "(в папке рядом с CSV)");
}

// ========================================================
// ОБЩИЙ РАЗДЕЛ — вспомогательные функции
// ========================================================

// Возвращает отсортированный массив File из папки (только изображения)
function getSortedImages(folder) {
    var result = [];
    if (!folder || !folder.exists) return result;
    var extensions = { "jpg":1, "jpeg":1, "png":1, "tif":1, "tiff":1, "psd":1 };
    var files = folder.getFiles();
    // Сортируем по имени
    files.sort(function(a, b) {
        var an = a.displayName || a.name;
        var bn = b.displayName || b.name;
        if (an < bn) return -1;
        if (an > bn) return 1;
        return 0;
    });
    for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof Folder) continue;
        var fname = files[i].displayName || files[i].name;
        var dot = fname.lastIndexOf(".");
        if (dot < 0) continue;
        if (extensions[fname.substring(dot + 1).toLowerCase()]) {
            result.push(files[i]);
        }
    }
    return result;
}

// Заполняет страницу общего раздела по роли
// files — массив объектов File для подстановки
function fillCommonPage(page, role, files) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];

    overrideMaster(page);
    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var lbl; try { lbl = items[j].label; } catch(e) { continue; }
        if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
    }

    // Определяем метки по роли
    var labels = [];
    if (role === "jCollage") {
        labels = ["collagePhoto_1","collagePhoto_2","collagePhoto_3",
                  "collagePhoto_4","collagePhoto_5","collagePhoto_6"];
    } else if (role === "jQuarter") {
        labels = ["quarterPhoto_1","quarterPhoto_2"];
    } else if (role === "jHalf") {
        labels = ["halfPhoto_1","halfPhoto_2"];
    } else if (role === "jClassPhoto" || role === "jClassPhotoRight") {
        labels = ["classPhotoFrame"];
    }

    // Подставляем фото по меткам
    for (var i = 0; i < labels.length; i++) {
        var frame = byLabel[labels[i]];
        // Для jQuarter пробуем также halfPhoto_N — дизайнер мог использовать эти метки
        if (!frame && role === "jQuarter") {
            frame = byLabel["halfPhoto_" + (i + 1)];
        }
        if (!frame) continue;
        if (i < files.length) {
            if (placeImage(frame, files[i])) {
                parts.push(labels[i]);
            } else {
                result.errors++;
                parts.push(labels[i] + ":ОШИБКА");
            }
        }
        // Если файла нет — фрейм остаётся пустым
    }

    result.summary = parts.join(", ");
    return result;
}

// ========================================================
// ЗАПОЛНЕНИЕ F-Head-SmallGrid (классрук + до 4 предметников)
// ========================================================

function fillSmallGridPage(page, head, sideTeachers, idx) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];

    overrideMaster(page);
    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var lbl; try { lbl = items[j].label; } catch(e) { continue; }
        if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
    }

    // Заполняем классрука
    if (head) {
        fillByLabel(byLabel, "headTeacherName", head.name, parts, result);
        fillByLabel(byLabel, "headTeacherRole", head.role, parts, result);
        fillByLabel(byLabel, "headTextFrame",   head.text, parts, result);
        fillPhotoByLabel(byLabel, "headTeacherPhoto", head.photo, idx, parts, result);
    }

    // Заполняем предметников
    var MAX = 4;
    for (var i = 0; i < Math.min(sideTeachers.length, MAX); i++) {
        var t = sideTeachers[i];
        var n = i + 1;
        fillByLabel(byLabel, "sideTeacherName_" + n, t.name,  parts, result);
        fillByLabel(byLabel, "sideTeacherRole_" + n, t.role,  parts, result);
        fillPhotoByLabel(byLabel, "sideTeacherPhoto_" + n, t.photo, idx, parts, result);
    }
    // Скрываем незаполненные слоты
    for (var s = sideTeachers.length + 1; s <= MAX; s++) {
        hideByLabel(byLabel, "sideTeacherName_"  + s);
        hideByLabel(byLabel, "sideTeacherRole_"  + s);
        hideByLabel(byLabel, "sideTeacherPhoto_" + s);
    }

    result.summary = parts.join(", ");
    return result;
}

// ========================================================
// ЗАПОЛНЕНИЕ F-Head-Overflow (классрук + до 8 предметников-переполнения)
// ========================================================

function fillOverflowPage(page, head, overflowTeachers, idx) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];

    overrideMaster(page);
    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var lbl; try { lbl = items[j].label; } catch(e) { continue; }
        if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
    }

    // Классрук
    if (head) {
        fillByLabel(byLabel, "headTeacherName", head.name, parts, result);
        fillByLabel(byLabel, "headTeacherRole", head.role, parts, result);
        fillByLabel(byLabel, "headTextFrame",   head.text, parts, result);
        fillPhotoByLabel(byLabel, "headTeacherPhoto", head.photo, idx, parts, result);
    }

    // Предметники-переполнение
    var MAX = 8;
    for (var i = 0; i < Math.min(overflowTeachers.length, MAX); i++) {
        var t = overflowTeachers[i];
        var n = i + 1;
        fillByLabel(byLabel, "overflowTeacherName_" + n, t.name, parts, result);
        fillByLabel(byLabel, "overflowTeacherRole_" + n, t.role, parts, result);
        fillPhotoByLabel(byLabel, "overflowTeacherPhoto_" + n, t.photo, idx, parts, result);
    }
    for (var s = overflowTeachers.length + 1; s <= MAX; s++) {
        hideByLabel(byLabel, "overflowTeacherName_"  + s);
        hideByLabel(byLabel, "overflowTeacherRole_"  + s);
        hideByLabel(byLabel, "overflowTeacherPhoto_" + s);
    }

    result.summary = parts.join(", ");
    return result;
}

// ========================================================
// УНИВЕРСАЛЬНОЕ ЗАПОЛНЕНИЕ СЕТКИ ПРЕДМЕТНИКОВ
// Работает для G-TeachersGrid-WithPhoto (maxSlots=8) и G-Teachers-Large (maxSlots=16)
// ========================================================

function fillGridPageUniversal(page, teachers, maxSlots, hasPhoto, idx) {
    var result = { errors: 0, warnings: 0, lines: [] };

    overrideMaster(page);
    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var lbl; try { lbl = items[j].label; } catch(e) { continue; }
        if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
    }

    for (var i = 0; i < Math.min(teachers.length, maxSlots); i++) {
        var t = teachers[i];
        var slot = i + 1;
        var parts = [];
        var lineResult = { errors: 0, warnings: 0 };

        fillByLabel(byLabel, "teacherName_"  + slot, t.name, parts, lineResult);
        fillByLabel(byLabel, "teacherRole_"  + slot, t.role, parts, lineResult);
        fillPhotoByLabel(byLabel, "teacherPhoto_" + slot, t.photo, idx, parts, lineResult);

        result.errors   += lineResult.errors;
        result.warnings += lineResult.warnings;

        var pfx = lineResult.errors > 0 ? "[ERR] " : (lineResult.warnings > 0 ? "[WARN]" : "[OK]  ");
        result.lines.push(pfx + "слот " + slot + ". " + t.name + " | " + parts.join(", "));
    }

    // Скрываем незаполненные слоты
    for (var s = teachers.length + 1; s <= maxSlots; s++) {
        hideByLabel(byLabel, "teacherName_"  + s);
        hideByLabel(byLabel, "teacherRole_"  + s);
        hideByLabel(byLabel, "teacherPhoto_" + s);
    }

    // classPhotoFrame для G-TeachersGrid-WithPhoto
    // Фото подставляется снаружи (в основном цикле) через classPhotoTeacher
    if (hasPhoto) {
        var cpf = byLabel["classPhotoFrame"];
        if (cpf) {
            result.classPhotoFrame = cpf; // передаём фрейм наружу
        }
    }

    return result;
}

// ========================================================

function fillByLabel(byLabel, label, text, parts, result) {
    var item = byLabel[label];
    if (!item) return;
    try {
        item.contents = text || "";
        if (text) parts.push(label.split("_")[0]);
    } catch(e) { result.errors++; }
}

function fillPhotoByLabel(byLabel, label, filename, idx, parts, result) {
    var item = byLabel[label];
    if (!item) return;
    if (!filename || filename === "") {
        result.warnings++;
        parts.push(label + ":нет_в_csv");
        return;
    }
    var found = findInIndex(idx, filename);
    if (found) {
        placeImage(item, found.file)
            ? parts.push(label + (found.fuzzy ? "~" : ""))
            : (result.errors++, parts.push(label + ":ОШИБКА"));
    } else {
        result.warnings++;
        parts.push(label + ":нет_файла");
    }
}

function hideByLabel(byLabel, label) {
    var item = byLabel[label];
    if (!item) return;
    try { item.contents = ""; item.visible = false; } catch(e) {}
    try { item.visible = false; } catch(e) {}
}

// ========================================================
// ЗАПОЛНЕНИЕ СТРАНИЦЫ КЛАССРУКА (оригинальная, обёртка)
// ========================================================

function fillHeadPage(page, head, idx) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];

    overrideMaster(page);

    // Снимок в статичный массив — live-коллекция allPageItems меняется при итерации
    var items = snapshotItems(page);
    var filled = { name: false, role: false, text: false, photo: false };

    for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var lbl;
        try { lbl = it.label; } catch(e) { continue; }
        if (!lbl || lbl === "") continue;

        if (lbl === "headTeacherName" && !filled.name) {
            try { it.contents = head.name; filled.name = true; parts.push("имя"); }
            catch(e) { result.errors++; parts.push("ОШИБКА_ИМЕНИ"); }

        } else if (lbl === "headTeacherRole" && !filled.role) {
            try { it.contents = head.role; filled.role = true; parts.push("должность"); }
            catch(e) { result.errors++; parts.push("ОШИБКА_ДОЛЖНОСТИ"); }

        } else if (lbl === "headTextFrame" && !filled.text) {
            try {
                it.contents = head.text;
                parts.push(head.text !== "" ? "текст" : "текст:пусто");
                filled.text = true;
            } catch(e) { result.errors++; parts.push("ОШИБКА_ТЕКСТА"); }

        } else if (lbl === "headTeacherPhoto" && !filled.photo) {
            if (head.photo === "") {
                result.warnings++; parts.push("фото:не_указано");
            } else {
                var f = findInIndex(idx, head.photo);
                if (f) {
                    placeImage(it, f.file)
                        ? (filled.photo = true, parts.push(f.fuzzy ? "фото~" : "фото"))
                        : (result.errors++, parts.push("ОШИБКА_ФОТО"));
                } else {
                    result.warnings++; parts.push("нет_файла:" + head.photo);
                }
            }
        }
    }

    result.summary = parts.join(", ");
    return result;
}

// ========================================================
// ЗАПОЛНЕНИЕ СТРАНИЦЫ СЕТКИ ПРЕДМЕТНИКОВ
// ========================================================

function fillGridPage(page, subjects, idx) {
    var result = { errors: 0, warnings: 0, lines: [] };

    overrideMaster(page);

    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var it = items[j];
        try { if (it.label && it.label !== "" && !byLabel[it.label]) byLabel[it.label] = it; } catch(e) {}
    }

    for (var i = 0; i < subjects.length; i++) {
        var t = subjects[i];
        var slot = i + 1;
        var parts = [];

        var nameIt  = byLabel["teacherName_"  + slot];
        var roleIt  = byLabel["teacherRole_"  + slot];
        var photoIt = byLabel["teacherPhoto_" + slot];

        if (nameIt) {
            try { nameIt.contents = t.name; parts.push("имя"); }
            catch(e) { result.errors++; parts.push("ОШИБКА_ИМЕНИ"); }
        } else { result.errors++; parts.push("НЕТ_МЕТКИ_ИМЕНИ_" + slot); }

        if (roleIt) {
            try { roleIt.contents = t.role; parts.push(t.role ? "должность" : "должность:пусто"); }
            catch(e) { result.errors++; parts.push("ОШИБКА_ДОЛЖНОСТИ"); }
        } else { result.errors++; parts.push("НЕТ_МЕТКИ_ДОЛЖНОСТИ_" + slot); }

        if (photoIt) {
            if (t.photo === "") {
                result.warnings++; parts.push("фото:не_указано");
            } else {
                var f = findInIndex(idx, t.photo);
                if (f) {
                    placeImage(photoIt, f.file)
                        ? parts.push(f.fuzzy ? "фото~" : "фото")
                        : (result.errors++, parts.push("ОШИБКА_ФОТО"));
                } else {
                    result.warnings++; parts.push("нет_файла:" + t.photo);
                }
            }
        } else { result.errors++; parts.push("НЕТ_МЕТКИ_ФОТО_" + slot); }

        var hasErr  = false, hasWarn = false;
        for (var p = 0; p < parts.length; p++) {
            if (parts[p].indexOf("ОШИБКА") === 0 || parts[p].indexOf("НЕТ_МЕТКИ") === 0) hasErr = true;
            if (parts[p].indexOf("нет_файла") === 0) hasWarn = true;
        }
        result.lines.push(
            (hasErr ? "[ERR] " : (hasWarn ? "[WARN]" : "[OK]  ")) +
            "слот " + slot + ". " + t.name + " | " + parts.join(", ")
        );
    }

    // Скрываем незаполненные слоты
    for (var s = subjects.length + 1; s <= 8; s++) {
        var n  = byLabel["teacherName_"  + s];
        var r  = byLabel["teacherRole_"  + s];
        var ph = byLabel["teacherPhoto_" + s];
        try { if (n)  { n.contents  = ""; n.visible  = false; } } catch(e) {}
        try { if (r)  { r.contents  = ""; r.visible  = false; } } catch(e) {}
        try { if (ph) { ph.visible  = false; } } catch(e) {}
    }

    return result;
}

// ========================================================
// ЗАПОЛНЕНИЕ СТРАНИЦЫ УЧЕНИКА
// ========================================================

function fillStudentPage(page, student, idx, configType, studentMaster) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];

    // Стандарт (1) — только портрет + имя + цитата
    // Универсал (2) — + 2 фото с друзьями
    // Максимум (3) — левая: портрет + имя + цитата; правая: 4 фото (без портрета)
    var fillFriendPhotos = (configType === "2" || configType === "3");
    var maxFriendPhotos  = (configType === "3") ? 4 : 2;

    // Для одностраничных мастеров (E-Student-Left/Right) — стандартный override.
    // Для двухстраничных (E-Student-Default) — фильтрованный по стороне.
    if (studentMaster && studentMaster.pages && studentMaster.pages.length > 1) {
        overrideMasterByPageSide(page, studentMaster);
    } else {
        overrideMaster(page);
    }

    var items = snapshotItems(page);
    var filled = { name: false, quote: false, portrait: false };
    var photosPlaced = 0;

    for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var lbl;
        try { lbl = it.label; } catch(e) { continue; }
        if (!lbl || lbl === "") continue;

        if (lbl === "studentName" && !filled.name) {
            try { it.contents = student.name; filled.name = true; parts.push("имя"); }
            catch(e) { result.errors++; parts.push("ОШИБКА_ИМЕНИ"); }

        } else if (lbl === "studentQuote" && !filled.quote) {
            try {
                it.contents = student.quote;
                parts.push(student.quote !== "" ? "цитата" : "цитата:пусто");
                filled.quote = true;
            } catch(e) { result.errors++; parts.push("ОШИБКА_ЦИТАТЫ"); }

        } else if (lbl === "studentPortrait" && !filled.portrait) {
            if (student.portrait === "") {
                result.warnings++; parts.push("портрет:не_указан");
            } else {
                var pf = findInIndex(idx, student.portrait);
                if (pf) {
                    placeImage(it, pf.file)
                        ? (filled.portrait = true, parts.push(pf.fuzzy ? "портрет~" : "портрет"))
                        : (result.errors++, parts.push("ОШИБКА_ПОРТРЕТА"));
                } else {
                    result.warnings++; parts.push("нет_файла:" + student.portrait);
                }
            }

        } else if (lbl.indexOf("studentPhoto") === 0) {
            if (!fillFriendPhotos) continue;
            var photoNum = parseInt(lbl.substring(12), 10);
            if (isNaN(photoNum) || photoNum < 1 || photoNum > maxFriendPhotos) continue;
            var photoIdx = photoNum - 1;

            if (photoIdx < student.friendPhotos.length) {
                var ff = findInIndex(idx, student.friendPhotos[photoIdx]);
                if (ff) {
                    placeImage(it, ff.file) ? photosPlaced++ : (result.errors++, parts.push("ОШИБКА_ФОТО" + photoNum));
                } else {
                    result.warnings++; parts.push("нет_файла_фото" + photoNum);
                }
            }
        }
    }

    if (photosPlaced > 0) parts.push("фото:" + photosPlaced);
    result.summary = parts.join(", ");
    return result;
}

// ========================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ========================================================

// ========================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ СЕТОЧНЫХ КОМПЛЕКТАЦИЙ
// ========================================================

// Выбор сетки для комплектации Лайт (4 страницы, ≤24 учеников)
function getLightGrid(n) {
    if (n <= 8)  return { slotsPerPage: 2,  suffix: "2",  cols: 2, rows: 1 };
    if (n <= 12) return { slotsPerPage: 3,  suffix: "3",  cols: 3, rows: 1 };
    if (n <= 16) return { slotsPerPage: 4,  suffix: "4",  cols: 2, rows: 2 };
    return           { slotsPerPage: 6,  suffix: "6",  cols: 3, rows: 2 };  // 17-24
}

// Выбор сетки для комплектации Мини (2 страницы, ≤36 учеников)
function getMiniGrid(n) {
    if (n <= 9)  return { slotsPerPage: 4,  suffix: "4",  cols: 2, rows: 2 };
    if (n <= 12) return { slotsPerPage: 6,  suffix: "6",  cols: 2, rows: 3 };
    if (n <= 18) return { slotsPerPage: 9,  suffix: "9",  cols: 3, rows: 3 };
    return           { slotsPerPage: 12, suffix: "12", cols: 4, rows: 3 };  // 19-36
}

// Заполнение страницы с сеткой учеников
// students — срез массива для этой страницы
// slotsPerPage — максимум слотов на странице
// hasQuote — заполнять ли studentQuote_N (Медиум=true, Лайт/Мини=false)
function fillGridStudentPage(page, students, idx, slotsPerPage, hasQuote) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];

    overrideMaster(page);
    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var lbl; try { lbl = items[j].label; } catch(e) { continue; }
        if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
    }

    for (var i = 0; i < students.length; i++) {
        var n = i + 1;
        var s = students[i];
        fillPhotoByLabel(byLabel, "studentPortrait_" + n, s.portrait, idx, parts, result);
        fillByLabel(byLabel, "studentName_" + n, s.name, parts, result);
        if (hasQuote) {
            fillByLabel(byLabel, "studentQuote_" + n, s.quote, parts, result);
        }
    }

    // Скрываем пустые слоты
    for (var slot = students.length + 1; slot <= slotsPerPage; slot++) {
        hideByLabel(byLabel, "studentPortrait_" + slot);
        hideByLabel(byLabel, "studentName_" + slot);
        if (hasQuote) hideByLabel(byLabel, "studentQuote_" + slot);
    }

    result.summary = students.length > 0 ? (students[0].name + (students.length > 1 ? " … " + students[students.length-1].name : "")) : "(пусто)";
    return result;
}

// ========================================================
// ЗАПОЛНЕНИЕ F-Head-WithPhoto (классрук + фото класса снизу)
// Используется при 0, 9-16 предметниках
// overflowSideCount > 0 означает: это F-Head-LargeGrid с overflow (17+)
// ========================================================
function fillHeadWithPhotoPage(page, head, sideTeachers, overflowSideCount, idx, photos, photoIdx, preTeacherPhoto) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];
    overrideMaster(page);
    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var lbl; try { lbl = items[j].label; } catch(e) { continue; }
        if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
    }
    // Классрук
    fillByLabel(byLabel, "headTeacherName", head.name,  parts, result);
    fillByLabel(byLabel, "headTeacherRole", head.role,  parts, result);
    fillByLabel(byLabel, "headTextFrame",   head.text,  parts, result);
    fillPhotoByLabel(byLabel, "headTeacherPhoto", head.photo, idx, parts, result);
    // classPhotoFrame — используем предварительно выделенное фото
    var cpf = byLabel["classPhotoFrame"];
    if (cpf) {
        if (preTeacherPhoto) { placeImage(cpf, preTeacherPhoto); parts.push("classPhoto"); }
        else { result.warnings++; parts.push("classPhoto:нет"); }
    }
    // Overflow: предметники на левой странице (для F-Head-LargeGrid в режиме overflow)
    if (overflowSideCount > 0 && sideTeachers.length > 0) {
        var MAX = Math.min(overflowSideCount, sideTeachers.length);
        for (var i = 0; i < MAX; i++) {
            var t = sideTeachers[i]; var n = i + 1;
            fillByLabel(byLabel, "teacherName_" + n, t.name, parts, result);
            fillByLabel(byLabel, "teacherRole_" + n, t.role, parts, result);
            fillPhotoByLabel(byLabel, "teacherPhoto_" + n, t.photo, idx, parts, result);
        }
        for (var s = sideTeachers.length + 1; s <= overflowSideCount; s++) {
            hideByLabel(byLabel, "teacherName_" + s);
            hideByLabel(byLabel, "teacherRole_" + s);
            hideByLabel(byLabel, "teacherPhoto_" + s);
        }
    }
    result.summary = parts.join(", ");
    return result;
}

// ========================================================
// ЗАПОЛНЕНИЕ F-Head-SmallGrid / F-Head-LargeGrid
// (классрук + до 4 или до 8 предметников в строку/сетку)
// ========================================================
function fillSideTeachersPage(page, head, sideTeachers, maxSlots, idx, photos, photoIdx, preTeacherPhoto) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];
    overrideMaster(page);
    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var lbl; try { lbl = items[j].label; } catch(e) { continue; }
        if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
    }
    // Классрук
    fillByLabel(byLabel, "headTeacherName", head.name,  parts, result);
    fillByLabel(byLabel, "headTeacherRole", head.role,  parts, result);
    fillByLabel(byLabel, "headTextFrame",   head.text,  parts, result);
    fillPhotoByLabel(byLabel, "headTeacherPhoto", head.photo, idx, parts, result);
    // classPhotoFrame если есть (не у всех мастеров этого типа)
    var cpf2 = byLabel["classPhotoFrame"];
    if (cpf2 && preTeacherPhoto) {
        placeImage(cpf2, preTeacherPhoto); parts.push("classPhoto");
    }
    // Предметники
    for (var i = 0; i < Math.min(sideTeachers.length, maxSlots); i++) {
        var t = sideTeachers[i]; var n = i + 1;
        fillByLabel(byLabel, "teacherName_" + n, t.name, parts, result);
        // Пробуем все варианты метки должности (регистр и prefix)
        if      (byLabel["teacherRole_" + n])     { fillByLabel(byLabel, "teacherRole_" + n,     t.role, parts, result); }
        else if (byLabel["TeacherRole_" + n])     { fillByLabel(byLabel, "TeacherRole_" + n,     t.role, parts, result); }
        else if (byLabel["sideTeacherRole_" + n]) { fillByLabel(byLabel, "sideTeacherRole_" + n, t.role, parts, result); }
        fillPhotoByLabel(byLabel, "teacherPhoto_" + n, t.photo, idx, parts, result);
    }
    for (var s = sideTeachers.length + 1; s <= maxSlots; s++) {
        hideByLabel(byLabel, "teacherName_"    + s);
        hideByLabel(byLabel, "teacherRole_"    + s);
        hideByLabel(byLabel, "TeacherRole_"    + s);
        hideByLabel(byLabel, "sideTeacherRole_" + s);
        hideByLabel(byLabel, "teacherPhoto_"   + s);
    }
    result.summary = parts.join(", ");
    return result;
}

// ========================================================
// ЗАПОЛНЕНИЕ G-HalfClass (2 фото полкласса: halfLeftPhoto + halfRightPhoto)
// ========================================================
function fillHalfClassPage(page, photos, photoIdx) {
    var result = { errors: 0, warnings: 0, summary: "" };
    var parts = [];
    overrideMaster(page);
    var items = snapshotItems(page);
    var byLabel = {};
    for (var j = 0; j < items.length; j++) {
        var lbl; try { lbl = items[j].label; } catch(e) { continue; }
        if (lbl && lbl !== "" && !byLabel[lbl]) byLabel[lbl] = items[j];
    }
    // halfLeftPhoto и halfRightPhoto — два последовательных фото из half/
    var leftFrame  = byLabel["halfLeftPhoto"];
    var rightFrame = byLabel["halfRightPhoto"];
    var leftPhoto  = photos.half.length > photoIdx.half ? photos.half[photoIdx.half++] : null;
    var rightPhoto = photos.half.length > photoIdx.half ? photos.half[photoIdx.half++] : null;
    if (leftFrame && leftPhoto)   { placeImage(leftFrame,  leftPhoto);  parts.push("half1"); }
    else if (leftFrame)  { result.warnings++; parts.push("half1:нет"); }
    if (rightFrame && rightPhoto) { placeImage(rightFrame, rightPhoto); parts.push("half2"); }
    else if (rightFrame) { result.warnings++; parts.push("half2:нет"); }
    result.summary = parts.join(", ");
    return result;
}

function findMaster(doc, prefix, baseName) {
    var lbn = baseName.toLowerCase();
    for (var m = 0; m < doc.masterSpreads.length; m++) {
        var ms = doc.masterSpreads[m];
        if (ms.namePrefix === prefix && ms.baseName.toLowerCase() === lbn) return ms;
    }
    return null;
}

// Удаляет все переопределённые элементы мастера со страницы
// (возвращает страницу в «чистое» состояние шаблона)
function clearOverrides(page) {
    try {
        var items = snapshotItems(page);
        for (var i = 0; i < items.length; i++) {
            try { items[i].remove(); } catch(e) {}
        }
    } catch(e) {}
}

function overrideMaster(page) {
    try {
        var masterItems = page.masterPageItems;
        for (var i = 0; i < masterItems.length; i++) {
            try { masterItems[i].override(page); } catch(e) {}
        }
    } catch(e) {}
}

// Исправляет смещение элементов на standalone страницах (стр.1 в мягких листах).
// InDesign при оверрайде spread-мастера на standalone-страницу сохраняет абсолютные
// координаты мастер-разворота. RIGHT-страница мастера в gutter-centered системе
// имеет X < 0, поэтому элементы оказываются левее видимой области документа.
// Решение: сдвиг на +pageWidth переносит элементы в правильную позицию.
function fixStandalonePageItems(page) {
    var pb = [0,0,0,0];
    try { pb = page.bounds; } catch(e) { return; }
    var pageLeft  = pb[1];  // 0
    var pageRight = pb[3];  // 226
    var pageWidth = pageRight - pageLeft;
    if (pageWidth <= 0) return;

    // Прямые элементы страницы (без Image sub-объектов)
    var items = [];
    try {
        var pi = page.pageItems;
        for (var j = 0; j < pi.length; j++) {
            try { void pi[j].label; items.push(pi[j]); } catch(e) {}
        }
    } catch(e) { return; }
    if (items.length === 0) return;

    // Находим минимальный X
    var minX = 999999;
    for (var j2 = 0; j2 < items.length; j2++) {
        try { var b2 = items[j2].geometricBounds; if (b2[1] < minX) minX = b2[1]; } catch(e) {}
    }

    // ПРОХОД 1: если элементы за левым краем — сдвигаем на +pageWidth
    if (minX < pageLeft - 10) {
        for (var k = 0; k < items.length; k++) {
            try {
                var bk = items[k].geometricBounds; // [top, left, bottom, right]
                items[k].geometricBounds = [bk[0], bk[1] + pageWidth, bk[2], bk[3] + pageWidth];
            } catch(e) {}
        }
    }

    // ПРОХОД 2: прижимаем элементы которые всё ещё вне страницы
    // (заголовок мог остаться левее 0; photo frame мог выйти за правый край)
    for (var m = 0; m < items.length; m++) {
        try {
            var bm = items[m].geometricBounds;
            var iw  = bm[3] - bm[1]; // ширина элемента
            var ih  = bm[2] - bm[0]; // высота элемента
            var nl  = bm[1];         // новый left
            if (bm[1] < pageLeft) {
                nl = pageLeft; // прижать к левому краю
            } else if (bm[3] > pageRight) {
                nl = pageRight - iw; // прижать к правому краю
                if (nl < pageLeft) nl = pageLeft;
            }
            if (Math.abs(nl - bm[1]) > 0.5) { // двигаем если смещение > 0.5мм
                items[m].geometricBounds = [bm[0], nl, bm[0] + ih, nl + iw];
            }
        } catch(e) {}
    }
}

// Принудительно переопределяет элементы ПЕРВОЙ (левой) страницы мастер-разворота
// на документную страницу.
// Используется для isMiniSoft: F-*-R имеет контент на ЛЕВОЙ странице разворота.
// Работает правильно если контент физически размещён на pages[0] мастера.
// ИНСТРУКЦИЯ ДЛЯ ДИЗАЙНЕРА: в F-*-R мастерах весь контент должен быть на ЛЕВОЙ
// странице разворота (первая страница при просмотре мастера). Правая — пустая.
function overrideAsLeftPage(page, masterSpread) {
    if (!masterSpread) return;
    try {
        var mPages = masterSpread.pages;
        if (!mPages || mPages.length === 0) return;
        // Берём ВСЕ элементы первой (левой) страницы напрямую — без X-фильтра
        var mPage = mPages[0];
        var toOverride = [];
        try {
            var mItems = mPage.allPageItems;
            for (var j = 0; j < mItems.length; j++) {
                try { void mItems[j].label; toOverride.push(mItems[j]); } catch(e) {}
            }
        } catch(e) {}
        // Если страниц одна — берём все элементы разворота
        if (toOverride.length === 0) {
            try {
                var allItems = masterSpread.allPageItems;
                for (var k = 0; k < allItems.length; k++) {
                    try { void allItems[k].label; toOverride.push(allItems[k]); } catch(e) {}
                }
            } catch(e) {}
        }
        for (var i2 = 0; i2 < toOverride.length; i2++) {
            try { toOverride[i2].override(page); } catch(e) {}
        }
    } catch(e) {}
}

// Переопределяет элементы мастера на страницу документа.
// Для 2-страничных мастеров явно фильтрует элементы по X-координатам
// нужной страницы мастера — исключает элементы другой страницы.
function overrideMasterByPageSide(page, masterSpread) {
    if (!masterSpread) return;
    try {
        var masterPage = null;
        if (masterSpread.pages.length === 1) {
            masterPage = masterSpread.pages[0];
        } else {
            var isLeft = false;
            try { isLeft = (page.side === PageSideOptions.LEFT_HAND); } catch(e) {}
            masterPage = isLeft ? masterSpread.pages[0] : masterSpread.pages[1];
        }
        if (!masterPage) return;

        // Границы нужной страницы мастера в координатах мастер-разворота
        var mpb = null;
        try { mpb = masterPage.bounds; } catch(e) {} // [top, left, bottom, right]

        // Собираем статичный список — только элементы нужной страницы мастера
        // (фильтр по центру X внутри границ страницы мастера)
        var toOverride = [];
        try {
            var live = masterSpread.allPageItems;
            for (var j = 0; j < live.length; j++) {
                try {
                    var item = live[j];
                    void item.label; // проверяем валидность
                    if (mpb) {
                        var ib = item.geometricBounds; // [top,left,bottom,right]
                        var cx = (ib[1] + ib[3]) / 2;
                        // Берём только элементы чей центр внутри X-границ нужной страницы
                        if (cx >= mpb[1] - 5 && cx <= mpb[3] + 5) {
                            toOverride.push(item);
                        }
                    } else {
                        toOverride.push(item);
                    }
                } catch(e) {}
            }
        } catch(e) {}

        // Переопределяем отфильтрованные элементы на документную страницу
        for (var i = 0; i < toOverride.length; i++) {
            try { toOverride[i].override(page); } catch(e) {}
        }
    } catch(e) {}
}

// Версия overrideMasterByPageSide которая автоматически берёт мастер из page.appliedMaster.
// Используется для учительских страниц чтобы обойти проблему RIGHT-side мастеров
// применённых к LEFT-side страницам документа.
function overrideMasterByPageSideSafe(page) {
    var masterSpread = null;
    try { masterSpread = page.appliedMaster; } catch(e) {}
    if (!masterSpread) {
        overrideMaster(page); // fallback — стандартный override
        return;
    }
    overrideMasterByPageSide(page, masterSpread);
}

// Принудительно переопределяет элементы ЛЕВОЙ страницы мастер-разворота
// на документную страницу. Необходимо для isMiniSoft:
// когда F-мастер (двухстраничный) применяется к standalone RIGHT странице,
// InDesign применяет только правую страницу мастера (которая пустая).
// Эта функция явно берёт элементы с левой страницы мастера (где весь контент)
// и переопределяет их на нужную документную страницу.
function overrideMasterLeftPage(page, masterSpread) {
    if (!masterSpread) return;
    try {
        var mPages = masterSpread.pages;
        if (!mPages || mPages.length === 0) return;
        var mPage = mPages[0]; // Левая страница — там весь контент F-мастеров
        var toOverride = [];
        try {
            var live = mPage.allPageItems;
            for (var j = 0; j < live.length; j++) {
                try { void live[j].label; toOverride.push(live[j]); } catch(e) {}
            }
        } catch(e) {}
        for (var i = 0; i < toOverride.length; i++) {
            try { toOverride[i].override(page); } catch(e) {}
        }
    } catch(e) {}
}
// Проверяет каждый объект через label — невалидные пропускаем.
function snapshotItems(page) {
    var arr = [];
    try {
        var live = page.allPageItems;
        for (var i = 0; i < live.length; i++) {
            try {
                var item = live[i];
                // Проверяем что объект валиден — обращаемся к свойству
                void item.label;
                arr.push(item);
            } catch(e) {}
        }
    } catch(e) {}
    return arr;
}

// Вариант snapshotItems для 2-страничных мастеров (E-Student-*).
// Фильтрует элементы по принадлежности к текущей странице:
// берём только те элементы, чей ЦЕНТР находится в границах страницы.
// Это предотвращает попадание элементов соседней страницы мастера.
function snapshotItemsForPage(page) {
    var arr = [];
    var pb = null;
    try { pb = page.bounds; } catch(e) {} // [top, left, bottom, right] в координатах разворота

    try {
        var live = page.allPageItems;
        for (var i = 0; i < live.length; i++) {
            try {
                var item = live[i];
                void item.label;

                if (pb) {
                    var b = item.geometricBounds; // [top, left, bottom, right]
                    var cx = (b[1] + b[3]) / 2;
                    var cy = (b[0] + b[2]) / 2;
                    // Принимаем элемент если его центр внутри страницы (с допуском 5мм)
                    if (cx >= pb[1] - 5 && cx <= pb[3] + 5 &&
                        cy >= pb[0] - 5 && cy <= pb[2] + 5) {
                        arr.push(item);
                    }
                } else {
                    arr.push(item);
                }
            } catch(e) {}
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

function padNum(n, w) {
    var s = "" + n;
    while (s.length < w) s = "0" + s;
    return s;
}

// ========================================================
// ИНДЕКС ИЗОБРАЖЕНИЙ
// ========================================================

function buildImageIndex(rootFolder) {
    var exact = {}, canon = {}, canonDupes = {}, duplicates = [], count = 0;
    var extensions = { "jpg":1, "jpeg":1, "png":1, "tif":1, "tiff":1, "psd":1 };

    function canonKey(s) {
        var k = s.toLowerCase();

        // Нормализация NFD→NFC для кириллицы.
        // macOS хранит имена файлов в NFD: й = и + U+0306 (краткая),
        // ё = е + U+0308 (умляут). После stripping-а U+0306/U+0308
        // й превращается в и, и ключи не совпадают с CSV (NFC).
        // Заменяем вручную: и + U+0306 → й, е + U+0308 → ё
        var nfc = "";
        for (var ni = 0; ni < k.length; ni++) {
            var ch = k.charAt(ni);
            var code = k.charCodeAt(ni);
            var next = ni + 1 < k.length ? k.charCodeAt(ni + 1) : 0;
            if (code === 0x438 && next === 0x306) { nfc += "\u0439"; ni++; continue; } // и + ̆ → й
            if (code === 0x418 && next === 0x306) { nfc += "\u0419"; ni++; continue; } // И + ̆ → Й
            if (code === 0x435 && next === 0x308) { nfc += "\u0451"; ni++; continue; } // е + ̈ → ё
            if (code === 0x415 && next === 0x308) { nfc += "\u0401"; ni++; continue; } // Е + ̈ → Ё
            nfc += ch;
        }
        k = nfc;

        // Убираем (N) — суффиксы дублей
        var clean = "";
        var i = 0;
        while (i < k.length) {
            var ch2 = k.charAt(i);
            if (ch2 === '(') {
                var j = i + 1;
                while (j < k.length && k.charAt(j) !== ')') j++;
                i = j + 1;
                continue;
            }
            clean += ch2;
            i++;
        }

        // Оставляем только буквы и точку
        var r = "";
        for (var ci = 0; ci < clean.length; ci++) {
            var code2 = clean.charCodeAt(ci);
            if ((code2 >= 97 && code2 <= 122) ||
                (code2 >= 0x430 && code2 <= 0x44F) ||
                (code2 >= 0x410 && code2 <= 0x42F) ||
                code2 === 0x451 || code2 === 0x401 ||
                code2 === 46) {
                r += clean.charAt(ci);
            }
        }
        return r;
    }

    function nfcNormalize(s) {
        var r = "";
        for (var ni = 0; ni < s.length; ni++) {
            var code = s.charCodeAt(ni);
            var next = ni + 1 < s.length ? s.charCodeAt(ni + 1) : 0;
            if (code === 0x438 && next === 0x306) { r += "\u0439"; ni++; continue; }
            if (code === 0x418 && next === 0x306) { r += "\u0419"; ni++; continue; }
            if (code === 0x435 && next === 0x308) { r += "\u0451"; ni++; continue; }
            if (code === 0x415 && next === 0x308) { r += "\u0401"; ni++; continue; }
            r += s.charAt(ni);
        }
        return r;
    }

    function scan(folder) {
        var files = folder.getFiles();
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f instanceof Folder) { scan(f); continue; }

            var fname = f.displayName;
            if (!fname || fname === "") {
                try { fname = decodeURI(f.name); } catch(e) { fname = f.name; }
            }
            // Нормализуем NFD→NFC: macOS хранит й как и+U+0306
            fname = nfcNormalize(fname);
            var dot = fname.lastIndexOf(".");
            if (dot < 0) continue;
            if (!extensions[fname.substring(dot + 1).toLowerCase()]) continue;

            var eKey = fname.toLowerCase();
            if (exact[eKey]) {
                duplicates.push(fname);
            } else {
                exact[eKey] = f; count++;
            }

            var cKey = canonKey(fname);
            if (canon[cKey] && canon[cKey].fsName !== f.fsName) {
                canonDupes[cKey] = (canonDupes[cKey] || 1) + 1;
            } else {
                canon[cKey] = f;
            }
        }
    }

    scan(rootFolder);
    return { exact: exact, canon: canon, canonDupes: canonDupes,
             canonKey: canonKey, count: count, duplicates: duplicates };
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
    var result = { students: [], teachers: [], meta: { city: "", school: "", year: "", className: "" }, errors: [] };

    var file = new File(path);
    if (!file.exists) { result.errors.push("Файл не найден: " + path); return result; }

    file.encoding = "UTF-8";
    if (!file.open("r")) { result.errors.push("Не удалось открыть файл."); return result; }

    var raw = file.read();
    file.close();
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);

    var lines = splitLines(raw);
    if (lines.length < 2) { result.errors.push("CSV пустой."); return result; }

    // --- Ищем META строку и строку заголовка ---
    // META может быть первой строкой (до заголовка)
    var headerLineIdx = 0;
    var firstFields = parseCSVLine(lines[0]);
    if (trimStr(firstFields[0] || "") === "META") {
        // Первая строка — META
        result.meta.city   = trimStr(firstFields[1] || "");
        result.meta.school = trimStr(firstFields[2] || "");
        result.meta.year   = trimStr(firstFields[3] || "");
        headerLineIdx = 1; // заголовок на следующей строке
    }

    if (headerLineIdx >= lines.length) { result.errors.push("Не найдена строка заголовка."); return result; }

    var header = parseCSVLine(lines[headerLineIdx]);
    var cols = buildColIdx(header);

    for (var i = headerLineIdx + 1; i < lines.length; i++) {
        var line = lines[i];
        if (trimStr(line) === "") continue;

        var fields = parseCSVLine(line);
        if (fields.length < 2) continue;

        var rowClass = getField(fields, cols.klass);

        // Пропускаем META если вдруг встретится ещё раз
        if (rowClass === "META") continue;

        if (rowClass === "\u0423\u0427\u0418\u0422\u0415\u041b\u042c") {
            // Учитель
            var tname = getField(fields, cols.name);
            if (tname === "") continue;
            result.teachers.push({
                name:   tname,
                photo:  getField(fields, cols.portrait),
                role:   getField(fields, cols.cover),
                text:   getField(fields, cols.text),
                isHead: false
            });

        } else if (rowClass !== "") {
            // Ученик
            var sname = getField(fields, cols.name);
            if (sname === "") continue;

            // Запоминаем класс из первой строки ученика
            if (result.meta.className === "") result.meta.className = rowClass;

            var friendPhotos = [];
            for (var fp = 0; fp < cols.friends.length; fp++) {
                var ph = getField(fields, cols.friends[fp]);
                if (ph !== "") friendPhotos.push(ph);
            }

            result.students.push({
                name:         sname,
                portrait:     getField(fields, cols.portrait),
                quote:        getField(fields, cols.text),
                friendPhotos: friendPhotos
            });
        }
    }

    // Классрук — первый учитель с непустым text
    for (var h = 0; h < result.teachers.length; h++) {
        if (result.teachers[h].text !== "") {
            result.teachers[h].isHead = true;
            break;
        }
    }

    return result;
}

function buildColIdx(header) {
    var idx = { klass:-1, name:-1, portrait:-1, cover:-1, text:-1, friends:[] };
    for (var i = 0; i < header.length; i++) {
        var col = trimStr(header[i]).toLowerCase();
        if      (col === "\u043a\u043b\u0430\u0441\u0441") idx.klass = i;
        else if (col === "\u0443\u0447\u0435\u043d\u0438\u043a") idx.name = i;
        else if (col === "\u043f\u043e\u0440\u0442\u0440\u0435\u0442_\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430") idx.portrait = i;
        else if (col === "\u043e\u0431\u043b\u043e\u0436\u043a\u0430") idx.cover = i;
        else if (col === "\u0442\u0435\u043a\u0441\u0442") idx.text = i;
        else if (col.indexOf("\u0444\u043e\u0442\u043e_\u0434\u0440\u0443\u0437\u044c\u044f") === 0) idx.friends.push(i);
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

main();
