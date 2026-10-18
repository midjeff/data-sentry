import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { VIDEO_FORMAT_DESCRIPTION } from './videoFormats';

const en = {
  videoCancelled: 'Cancelled', restoreVideo: 'Restore', deleteQueueVideo: 'Remove from queue', videoCancelledMessage: 'Video analysis was cancelled.', reselectVideo: 'Reselect the original video to restore analysis.', reselectVideoError: 'Select a supported video with the original filename.', deleteQueueTitle: 'Remove video from queue?', deleteQueueMessage: 'Only this queue entry will be removed. Saved analysis history will be kept.',
  confirmDeleteTitle: 'Delete analysis?', confirmDeleteMessage: 'Are you sure you want to delete this analysis from history?', cancelDelete: 'Cancel', confirmDeleteAction: 'Delete', deleteFailed: 'Could not delete the analysis. Please try again.', emptyResultsHistory: 'No saved result selected.',
  historyActions: 'Analysis actions', shareAnalysis: 'Share', shareSummary: 'Analysis summary', copySummary: 'Copy summary', summaryCopied: 'Summary copied.', copyManually: 'Copy is unavailable. Select the text and copy it manually.', historyStatusUnknown: 'Analysis status unknown',
  historyDisplaySettings: 'History display settings', showHistoryIcons: 'Show Status Icons', showHistoryGroups: 'Show Batch Grouping', historyFlagged: 'Potential violations detected', historyClear: 'No potential violations detected',
  queueWaiting: 'Waiting', queueReady: 'Ready', queueAnalyzing: 'Scanning…', queueFailed: 'Error', inferenceNotConnected: 'Local inference service is not connected.', inferenceUnavailable: 'Real video analysis is unavailable: this project has no connected local AI backend. New uploads will not produce sample results. Saved history contains demonstration results.',
  videoFinished: 'Demo results ready: {name}', queueConcurrency: 'Concurrent videos', queueCount: '{done} of {total} videos analyzed · Demo', analysisQueue: 'Analysis queue',
  clearAll: 'Clear All', analyzeOne: 'Analyze Video', analyzeMany: 'Analyze {count} Videos', batchInvalid: 'Some files were skipped. Select supported, non-empty videos up to 2 GB each.', videoFailed: 'Failed', retryVideo: 'Retry', selectResultVideo: 'Select video results',
  scannerInProgress: 'In progress…',
  scannerPreparing: 'Preparing video', scannerFrames: 'Processing video frames', scannerDetection: 'Detecting objects and actions', scannerRegulations: 'Checking banking regulations', scannerReport: 'Generating analysis report', scannerTitle: 'Video inspection preview', scannerInspection: 'AI VIDEO INSPECTION · DEMO', scannerScanning: 'SCANNING', scannerFramesMessage: 'Simulating surveillance frame processing…', scannerDetectionMessage: 'Previewing object and activity detection…', scannerRegulationsMessage: 'Simulating banking regulation checks…',
  hideDetailsShort: 'Hide',
  hideDetails: 'Hide event details', showDetails: 'Show Details',
  history: 'Analysis history', historyLocal: 'Stored in this browser, including videos.', historyEmpty: 'Completed analyses will appear here.', deleteAnalysis: 'Delete analysis', savedAnalysis: 'Saved analysis', analysisRequest: 'Analysis request', defaultRequest: 'Review cash-handling activity.', requestPlaceholder: 'What should be checked in the video? (optional)', historyError: 'Could not read or save history. Browser storage may be unavailable or full; new records remain available in this session.',
  hideSidebar: 'Hide sidebar', showSidebar: 'Show sidebar',
  analysis: 'Video analysis', analysisShort: 'Analysis', results: 'Results',
  language: 'Interface language', lightTheme: 'Use light theme', darkTheme: 'Use dark theme',
  uploadTitle: 'Upload a video', uploadSubtitle: 'Select a recording to review cash-handling activity.',
  drop: 'Drag and drop your video here', or: 'or select a file from your device', choose: 'Choose file',
  video: 'Video', supported: `Supported formats: ${VIDEO_FORMAT_DESCRIPTION}`, local: 'Your video stays on this device.',
  remove: 'Remove file', start: 'Start analysis', invalid: `Select one non-empty video file (${VIDEO_FORMAT_DESCRIPTION}).`,
  ready: 'Ready for analysis', demo: 'Demo mode', demoNotice: 'Simulated processing and sample results. No AI analysis is performed.',
  scenario: 'Demo result', withEvents: 'Potential violations', noEvents: 'No violations',
  upload: 'Upload', processingTitle: 'Previewing analysis', processingSubtitle: 'This demo walks through the analysis workflow.',
  stageUpload: 'Preparing your local video…', stageAnalysis: 'Simulating the analysis stage…', stageResults: 'Preparing demonstration results…',
  cancel: 'Cancel', completed: 'Completed', pending: 'Pending', active: 'In progress',
  resultSubtitle: 'Review the video and demonstration events.', newAnalysis: 'New analysis',
  verdictFlagged: 'Potential violations detected', verdictClear: 'No potential violations detected',
  demoResults: 'Demonstration data — these events are not findings from your video.',
  recording: 'Source video', events: 'Detected events', details: 'Event details',
  violationType: 'Violation type', timestamp: 'Timestamp', explanation: 'Explanation', evidence: 'Evidence frames',
  evidenceNote: 'Illustrative placeholders, not extracted video frames.', frame: 'Demo frame', enlarge: 'Enlarge evidence frame',
  close: 'Close preview', regulation: 'Regulatory reference', reference: 'Demo reference · Cash-handling procedure, § 4.2',
  referenceNote: 'Placeholder only. An approved regulatory document must be supplied.',
  eventOne: 'Cash left unattended', eventTwo: 'Cash outside the designated area',
  explanationOne: 'Example scenario: cash remains on the counter after the operator leaves the workstation. Review the relevant video segment.',
  explanationTwo: 'Example scenario: cash is placed outside the designated counting area. Review the handling procedure and context.',
  clearTitle: 'No events to review', clearDescription: 'This demo scenario contains no potential violations.',
  playbackError: 'This video cannot be played in this browser. Its format or codec may be unsupported, or the file may be damaged. AVI, MKV, and some MOV files may require local conversion. Try an MP4 encoded with H.264. No automatic conversion is available.',
  seekNote: 'Demo timestamps are adjusted to the available video duration.',
};

type Messages = { [K in keyof typeof en]: string };
const ru: Messages = {
  videoCancelled: 'Отменено', restoreVideo: 'Восстановить', deleteQueueVideo: 'Удалить из очереди', videoCancelledMessage: 'Анализ видео был отменён.', reselectVideo: 'Выберите исходный видеофайл повторно для восстановления анализа.', reselectVideoError: 'Выберите поддерживаемое видео с исходным названием файла.', deleteQueueTitle: 'Удалить видео из очереди?', deleteQueueMessage: 'Будет удалена только эта запись очереди. Сохранённая история анализа останется.',
  confirmDeleteTitle: 'Удалить анализ?', confirmDeleteMessage: 'Вы уверены, что хотите удалить этот анализ из истории?', cancelDelete: 'Отмена', confirmDeleteAction: 'Удалить', deleteFailed: 'Не удалось удалить анализ. Попробуйте ещё раз.', emptyResultsHistory: 'Нет выбранного сохранённого результата.',
  historyActions: 'Действия с анализом', shareAnalysis: 'Поделиться', shareSummary: 'Сводка анализа', copySummary: 'Копировать сводку', summaryCopied: 'Сводка скопирована.', copyManually: 'Копирование недоступно. Выделите текст и скопируйте вручную.', historyStatusUnknown: 'Статус анализа неизвестен',
  historyDisplaySettings: 'Настройки отображения истории', showHistoryIcons: 'Показывать значки статуса', showHistoryGroups: 'Показывать группировку', historyFlagged: 'Обнаружены возможные нарушения', historyClear: 'Возможных нарушений не обнаружено',
  queueWaiting: 'В очереди', queueReady: 'Готово', queueAnalyzing: 'Сканирование...', queueFailed: 'Ошибка', inferenceNotConnected: 'Локальный сервис ИИ не подключён.', inferenceUnavailable: 'Реальный анализ недоступен: в проекте не подключён локальный ИИ-бэкенд. Новые загрузки не создают демонстрационные результаты. Сохранённая история содержит демо-результаты.',
  videoFinished: 'Демо-результаты готовы: {name}', queueConcurrency: 'Одновременно обрабатывать видео', queueCount: 'Обработано видео: {done} из {total} · Демо', analysisQueue: 'Очередь анализа',
  clearAll: 'Очистить всё', analyzeOne: 'Анализировать видео', analyzeMany: 'Анализировать видео: {count}', batchInvalid: 'Некоторые файлы пропущены. Выберите видео поддерживаемого формата размером от 1 байта до 2 ГБ.', videoFailed: 'Ошибка', retryVideo: 'Повторить', selectResultVideo: 'Выбрать результаты видео',
  scannerInProgress: 'В процессе...',
  scannerPreparing: 'Подготовка видео', scannerFrames: 'Обработка видеокадров', scannerDetection: 'Поиск объектов и действий', scannerRegulations: 'Проверка банковских нормативов', scannerReport: 'Формирование отчёта', scannerTitle: 'Предпросмотр анализа видеозаписи', scannerInspection: 'AI VIDEO INSPECTION · ДЕМО', scannerScanning: 'СКАНИРОВАНИЕ', scannerFramesMessage: 'Имитация обработки кадров видеонаблюдения…', scannerDetectionMessage: 'Демонстрация поиска объектов и действий…', scannerRegulationsMessage: 'Имитация проверки банковских нормативов…',
  hideDetailsShort: 'Скрыть',
  hideDetails: 'Скрыть детали события', showDetails: 'Показать детали',
  history: 'История анализов', historyLocal: 'Хранится в этом браузере вместе с видео.', historyEmpty: 'Здесь появятся завершённые анализы.', deleteAnalysis: 'Удалить анализ', savedAnalysis: 'Сохранённый анализ', analysisRequest: 'Запрос на анализ', defaultRequest: 'Проверить операции с наличными.', requestPlaceholder: 'Что нужно проверить в видео? (необязательно)', historyError: 'Не удалось прочитать или сохранить историю. Хранилище браузера недоступно или заполнено; новые записи доступны в текущем сеансе.',
  hideSidebar: 'Скрыть боковое меню', showSidebar: 'Открыть боковое меню',
  analysis: 'Анализ видео', analysisShort: 'Анализ', results: 'Результаты',
  language: 'Язык интерфейса', lightTheme: 'Включить светлую тему', darkTheme: 'Включить тёмную тему',
  uploadTitle: 'Загрузите видео', uploadSubtitle: 'Выберите запись для проверки операций с наличными.',
  drop: 'Перетащите видео сюда', or: 'или выберите файл на устройстве', choose: 'Выбрать файл',
  video: 'Видео', supported: `Поддерживаемые форматы: ${VIDEO_FORMAT_DESCRIPTION}`, local: 'Видео остаётся на вашем устройстве.',
  remove: 'Удалить файл', start: 'Начать анализ', invalid: `Выберите один непустой видеофайл (${VIDEO_FORMAT_DESCRIPTION}).`,
  ready: 'Готово к анализу', demo: 'Деморежим', demoNotice: 'Имитация обработки и примеры результатов. ИИ-анализ не выполняется.',
  scenario: 'Демо-результат', withEvents: 'Возможные нарушения', noEvents: 'Без нарушений',
  upload: 'Загрузка', processingTitle: 'Предпросмотр анализа', processingSubtitle: 'Демонстрация этапов обработки видео.',
  stageUpload: 'Подготовка локального видео…', stageAnalysis: 'Имитация этапа анализа…', stageResults: 'Подготовка демонстрационных результатов…',
  cancel: 'Отменить', completed: 'Завершено', pending: 'Ожидание', active: 'В процессе',
  resultSubtitle: 'Просмотрите видео и демонстрационные события.', newAnalysis: 'Новый анализ',
  verdictFlagged: 'Обнаружены возможные нарушения', verdictClear: 'Возможные нарушения не обнаружены',
  demoResults: 'Демонстрационные данные — события не являются выводами по вашему видео.',
  recording: 'Исходное видео', events: 'Обнаруженные события', details: 'Детали события',
  violationType: 'Тип нарушения', timestamp: 'Время', explanation: 'Описание', evidence: 'Кадры события',
  evidenceNote: 'Иллюстрации, а не кадры из загруженного видео.', frame: 'Демо-кадр', enlarge: 'Увеличить кадр',
  close: 'Закрыть просмотр', regulation: 'Нормативный документ', reference: 'Демо-ссылка · Порядок работы с наличными, § 4.2',
  referenceNote: 'Пример. Требуется утверждённый нормативный документ.',
  eventOne: 'Наличные оставлены без присмотра', eventTwo: 'Наличные вне выделенной зоны',
  explanationOne: 'Пример ситуации: наличные остаются на стойке после ухода сотрудника с рабочего места. Проверьте соответствующий фрагмент видео.',
  explanationTwo: 'Пример ситуации: наличные размещены вне выделенной зоны пересчёта. Проверьте порядок работы и контекст события.',
  clearTitle: 'Нет событий для проверки', clearDescription: 'В этом демо-сценарии возможные нарушения отсутствуют.',
  playbackError: 'Не удалось воспроизвести видео в браузере. Возможно, формат или кодек не поддерживается либо файл повреждён. AVI, MKV и некоторые MOV могут требовать локальной конвертации. Попробуйте MP4 с кодеком H.264. Автоматическая конвертация недоступна.',
  seekNote: 'Демонстрационные отметки времени адаптированы к длительности видео.',
};

const kk: Messages = {
  videoCancelled: 'Бас тартылды', restoreVideo: 'Қалпына келтіру', deleteQueueVideo: 'Кезектен жою', videoCancelledMessage: 'Бейне талдауынан бас тартылды.', reselectVideo: 'Талдауды қалпына келтіру үшін бастапқы бейнені қайта таңдаңыз.', reselectVideoError: 'Бастапқы атауы бар қолдау көрсетілетін бейнені таңдаңыз.', deleteQueueTitle: 'Бейнені кезектен жою керек пе?', deleteQueueMessage: 'Тек кезек жазбасы жойылады. Сақталған талдау тарихы қалады.',
  confirmDeleteTitle: 'Талдауды жою керек пе?', confirmDeleteMessage: 'Осы талдауды тарихтан жойғыңыз келе ме?', cancelDelete: 'Бас тарту', confirmDeleteAction: 'Жою', deleteFailed: 'Талдауды жою мүмкін болмады. Қайталап көріңіз.', emptyResultsHistory: 'Сақталған нәтиже таңдалмаған.',
  historyActions: 'Талдау әрекеттері', shareAnalysis: 'Бөлісу', shareSummary: 'Талдау қорытындысы', copySummary: 'Қорытындыны көшіру', summaryCopied: 'Қорытынды көшірілді.', copyManually: 'Көшіру қолжетімсіз. Мәтінді таңдап, қолмен көшіріңіз.', historyStatusUnknown: 'Талдау күйі белгісіз',
  historyDisplaySettings: 'Тарихты көрсету баптаулары', showHistoryIcons: 'Күй белгілерін көрсету', showHistoryGroups: 'Топтастыруды көрсету', historyFlagged: 'Ықтимал бұзушылықтар анықталды', historyClear: 'Ықтимал бұзушылықтар анықталмады',
  queueWaiting: 'Кезекте', queueReady: 'Дайын', queueAnalyzing: 'Сканерлеу…', queueFailed: 'Қате', inferenceNotConnected: 'Жергілікті ЖИ қызметі қосылмаған.', inferenceUnavailable: 'Нақты талдау қолжетімсіз: жергілікті ЖИ бэкенді қосылмаған. Жаңа жүктеулер демо нәтижелер жасамайды. Сақталған тарихта демонстрациялық нәтижелер бар.',
  videoFinished: 'Демо нәтижелер дайын: {name}', queueConcurrency: 'Бір уақытта өңделетін бейнелер', queueCount: '{total} бейненің {done} өңделді · Демо', analysisQueue: 'Талдау кезегі',
  clearAll: 'Барлығын тазарту', analyzeOne: 'Бейнені талдау', analyzeMany: '{count} бейнені талдау', batchInvalid: 'Кейбір файлдар өткізілді. Қолдау көрсетілетін, бос емес, 2 ГБ дейінгі бейнелерді таңдаңыз.', videoFailed: 'Қате', retryVideo: 'Қайталау', selectResultVideo: 'Бейне нәтижелерін таңдау',
  scannerInProgress: 'Орындалуда…',
  scannerPreparing: 'Бейнені дайындау', scannerFrames: 'Бейне кадрларын өңдеу', scannerDetection: 'Нысандар мен әрекеттерді анықтау', scannerRegulations: 'Банк нормативтерін тексеру', scannerReport: 'Талдау есебін дайындау', scannerTitle: 'Бейне талдауын алдын ала қарау', scannerInspection: 'AI VIDEO INSPECTION · ДЕМО', scannerScanning: 'СКАНЕРЛЕУ', scannerFramesMessage: 'Бейне кадрларын өңдеуді имитациялау…', scannerDetectionMessage: 'Нысандар мен әрекеттерді анықтауды көрсету…', scannerRegulationsMessage: 'Банк нормативтерін тексеруді имитациялау…',
  hideDetailsShort: 'Жасыру',
  hideDetails: 'Оқиға мәліметтерін жасыру', showDetails: 'Мәліметтерді көрсету',
  history: 'Талдау тарихы', historyLocal: 'Бейнелермен бірге осы браузерде сақталады.', historyEmpty: 'Аяқталған талдаулар осында көрсетіледі.', deleteAnalysis: 'Талдауды жою', savedAnalysis: 'Сақталған талдау', analysisRequest: 'Талдау сұрауы', defaultRequest: 'Қолма-қол ақшамен операцияларды тексеру.', requestPlaceholder: 'Бейнеде нені тексеру керек? (міндетті емес)', historyError: 'Тарихты оқу немесе сақтау мүмкін болмады. Браузер қоймасы қолжетімсіз немесе толы; жаңа жазбалар осы сеанста қолжетімді.',
  hideSidebar: 'Бүйірлік мәзірді жасыру', showSidebar: 'Бүйірлік мәзірді ашу',
  analysis: 'Бейнені талдау', analysisShort: 'Талдау', results: 'Нәтижелер',
  language: 'Интерфейс тілі', lightTheme: 'Ашық тақырыпқа ауысу', darkTheme: 'Қараңғы тақырыпқа ауысу',
  uploadTitle: 'Бейнені жүктеңіз', uploadSubtitle: 'Қолма-қол ақшамен жасалатын операцияларды тексеру үшін жазбаны таңдаңыз.',
  drop: 'Бейнені осында сүйреп әкеліңіз', or: 'немесе құрылғыдан файл таңдаңыз', choose: 'Файлды таңдау',
  video: 'Бейне', supported: `Қолдау көрсетілетін пішімдер: ${VIDEO_FORMAT_DESCRIPTION}`, local: 'Бейне құрылғыңызда қалады.',
  remove: 'Файлды жою', start: 'Талдауды бастау', invalid: `Бос емес бір бейнефайлды таңдаңыз (${VIDEO_FORMAT_DESCRIPTION}).`,
  ready: 'Талдауға дайын', demo: 'Демо режим', demoNotice: 'Өңдеу имитациясы және нәтиже үлгілері. ЖИ талдауы орындалмайды.',
  scenario: 'Демо нәтижесі', withEvents: 'Ықтимал бұзушылықтар', noEvents: 'Бұзушылықтарсыз',
  upload: 'Жүктеу', processingTitle: 'Талдауды алдын ала қарау', processingSubtitle: 'Бейнені өңдеу кезеңдерінің көрсетілімі.',
  stageUpload: 'Жергілікті бейне дайындалуда…', stageAnalysis: 'Талдау кезеңі көрсетілуде…', stageResults: 'Демонстрациялық нәтижелер дайындалуда…',
  cancel: 'Бас тарту', completed: 'Аяқталды', pending: 'Күтілуде', active: 'Орындалуда',
  resultSubtitle: 'Бейнені және демонстрациялық оқиғаларды қараңыз.', newAnalysis: 'Жаңа талдау',
  verdictFlagged: 'Ықтимал бұзушылықтар анықталды', verdictClear: 'Ықтимал бұзушылықтар анықталмады',
  demoResults: 'Демонстрациялық деректер — бұл оқиғалар бейнеңіз бойынша қорытынды емес.',
  recording: 'Бастапқы бейне', events: 'Анықталған оқиғалар', details: 'Оқиға мәліметтері',
  violationType: 'Бұзушылық түрі', timestamp: 'Уақыт', explanation: 'Түсіндірме', evidence: 'Оқиға кадрлары',
  evidenceNote: 'Бұл суреттер жүктелген бейненің кадрлары емес.', frame: 'Демо кадр', enlarge: 'Кадрды үлкейту',
  close: 'Қарауды жабу', regulation: 'Нормативтік құжат', reference: 'Демо сілтеме · Қолма-қол ақшамен жұмыс тәртібі, § 4.2',
  referenceNote: 'Тек үлгі. Бекітілген нормативтік құжат қажет.',
  eventOne: 'Қолма-қол ақша қараусыз қалды', eventTwo: 'Қолма-қол ақша белгіленген аймақтан тыс',
  explanationOne: 'Жағдай үлгісі: қызметкер жұмыс орнынан кеткеннен кейін қолма-қол ақша үстелде қалады. Бейненің тиісті бөлігін тексеріңіз.',
  explanationTwo: 'Жағдай үлгісі: қолма-қол ақша санауға арналған аймақтан тыс қойылған. Жұмыс тәртібін және оқиға мәнмәтінін тексеріңіз.',
  clearTitle: 'Тексерілетін оқиғалар жоқ', clearDescription: 'Бұл демо сценарийде ықтимал бұзушылықтар жоқ.',
  playbackError: 'Браузерде бейнені ойнату мүмкін болмады. Пішімге немесе кодекке қолдау көрсетілмеуі не файл зақымдалуы мүмкін. AVI, MKV және кейбір MOV файлдарын жергілікті түрлендіру қажет болуы мүмкін. H.264 кодегі бар MP4 файлын қолданып көріңіз. Автоматты түрлендіру қолжетімсіз.',
  seekNote: 'Демо уақыт белгілері бейненің ұзақтығына бейімделген.',
};

export type Language = 'ru' | 'kk' | 'en';
export type MessageKey = keyof Messages;
const dictionaries = { ru, kk, en };
const I18nContext = createContext<{ language: Language; setLanguage: (value: Language) => void; t: (key: MessageKey) => string } | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('ru');
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <I18nContext.Provider value={{ language, setLanguage, t: (key) => dictionaries[language][key] }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18nProvider is required');
  return context;
}
