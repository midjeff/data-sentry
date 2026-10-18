import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { VIDEO_FORMAT_DESCRIPTION } from './videoFormats';

const en = {
  history: 'Analysis history', historyEmpty: 'Your server analyses will appear here.',
  hideSidebar: 'Hide sidebar', showSidebar: 'Show sidebar',
  analysis: 'Video analysis', analysisShort: 'Analysis', results: 'Results',
  language: 'Interface language', lightTheme: 'Use light theme', darkTheme: 'Use dark theme',
  uploadTitle: 'Upload a video', uploadSubtitle: 'Select a recording to review cash-handling activity.',
  drop: 'Drag and drop your video here', or: 'or select a file from your device', choose: 'Choose file',
  video: 'Video', supported: `Supported formats: ${VIDEO_FORMAT_DESCRIPTION}`, local: 'The video is sent to the server only when you start analysis.',
  remove: 'Remove file', start: 'Start analysis', invalid: `Select one non-empty video file (${VIDEO_FORMAT_DESCRIPTION}).`,
  ready: 'Ready to upload', demo: 'Demonstration result', demoNotice: 'The server is running a development demonstration. No AI findings are produced.',
  upload: 'Upload', processingTitle: 'Video processing', processingSubtitle: 'The server provides the processing status.',
  stageUpload: 'Uploading and validating the video…', stageAnalysis: 'Waiting for the server result…',
  completed: 'Completed', pending: 'Pending', active: 'In progress',
  resultSubtitle: 'Review the video and the result supplied by the server.', newAnalysis: 'New analysis',
  verdictFlagged: 'Signs of possible violations detected', verdictClear: 'No violation detected',
  demoResults: 'Artificial demonstration events. These video frames do not prove a real violation.',
  recording: 'Source video', events: 'Events', details: 'Event details',
  violationType: 'Violation type', timestamp: 'Timestamp', explanation: 'Explanation', evidence: 'Evidence frames',
  evidenceNote: 'Timestamps refer to the actual frames selected by the server.', frame: 'Video frame', enlarge: 'Enlarge evidence frame',
  close: 'Close preview', regulation: 'Regulatory reference',
  clearTitle: 'No events to review', clearDescription: 'The final server result contains no violations.',
  playbackError: 'This browser cannot play the video or the media is unavailable. Codec support varies, including for AVI, MKV and MOV. Try a browser-compatible H.264 MP4 for playback. Upload acceptance does not depend on browser playback; no automatic conversion is performed.',
  seekNote: 'Select an event to seek to its source-video timestamp.',
  loading: 'Loading…', refreshHistory: 'Refresh history', previousPage: 'Previous', nextPage: 'Next',
  retryConnection: 'Retry connection', backToUpload: 'Back to upload', continuesOnServer: 'The job continues on the server.',
  serverValidation: 'The server checks the file size and video stream.', serverStage: 'Server stage',
  queued: 'Queued', preparing: 'Preparing', observing: 'Observing', reasoning: 'Validating the decision', evidenceStage: 'Extracting frames', finalizing: 'Finalizing',
  analysisFailed: 'Analysis failed', evidenceUnavailable: 'Frame unavailable',
  uploadUncertain: 'The server may have accepted the upload. Refresh history before deciding to submit again.',
  errorNetwork: 'Connection to the server is unavailable. The last known status is preserved.',
  errorSession: 'The session has expired or is unavailable. Refresh the connection to recover access with the current cookie.',
  errorCsrf: 'The session token needs to be refreshed. Retry manually; the upload has not been resubmitted.',
  errorInvalidResponse: 'The server returned an invalid response. A successful result cannot be displayed.',
  errorInvalidUpload: 'Send exactly one non-empty supported video file.',
  errorTooLarge: 'The file exceeds the server’s configured upload limit.',
  errorMedia: 'The server could not read this video. It may be damaged or use an unsupported codec.',
  errorUnavailable: 'Processing is unavailable. Check that the API and a compatible worker are running.',
  errorQueue: 'The server queue is full. Try again later.',
  errorTimeout: 'The server reports that the job deadline was exceeded.',
  errorInterrupted: 'The server worker was interrupted. This analysis did not complete.',
  errorResult: 'A valid final decision or its evidence is unavailable.',
  errorNotFound: 'This analysis is unavailable to the current browser session.',
  errorFailed: 'The server could not complete the analysis.',
};

type Messages = { [K in keyof typeof en]: string };
const ru: Messages = {
  history: 'История анализов', historyEmpty: 'Здесь появятся ваши серверные анализы.',
  hideSidebar: 'Скрыть боковое меню', showSidebar: 'Открыть боковое меню',
  analysis: 'Анализ видео', analysisShort: 'Анализ', results: 'Результаты',
  language: 'Язык интерфейса', lightTheme: 'Включить светлую тему', darkTheme: 'Включить тёмную тему',
  uploadTitle: 'Загрузите видео', uploadSubtitle: 'Выберите запись для проверки операций с наличными.',
  drop: 'Перетащите видео сюда', or: 'или выберите файл на устройстве', choose: 'Выбрать файл',
  video: 'Видео', supported: `Поддерживаемые форматы: ${VIDEO_FORMAT_DESCRIPTION}`, local: 'Видео отправляется на сервер только после запуска анализа.',
  remove: 'Удалить файл', start: 'Начать анализ', invalid: `Выберите один непустой видеофайл (${VIDEO_FORMAT_DESCRIPTION}).`,
  ready: 'Готово к загрузке', demo: 'Демонстрационный результат', demoNotice: 'Сервер выполняет демонстрационную обработку. Выводы ИИ не формируются.',
  upload: 'Загрузка', processingTitle: 'Обработка видео', processingSubtitle: 'Статус обработки поступает от сервера.',
  stageUpload: 'Загрузка и проверка видео…', stageAnalysis: 'Ожидание результата сервера…',
  completed: 'Завершено', pending: 'Ожидание', active: 'В процессе',
  resultSubtitle: 'Просмотрите видео и результат, полученный от сервера.', newAnalysis: 'Новый анализ',
  verdictFlagged: 'Обнаружены признаки возможных нарушений', verdictClear: 'Нарушение не обнаружено',
  demoResults: 'Искусственные демонстрационные события. Кадры видео не доказывают реального нарушения.',
  recording: 'Исходное видео', events: 'События', details: 'Детали события',
  violationType: 'Тип нарушения', timestamp: 'Время', explanation: 'Описание', evidence: 'Кадры события',
  evidenceNote: 'Время относится к фактическим кадрам, выбранным сервером.', frame: 'Кадр видео', enlarge: 'Увеличить кадр',
  close: 'Закрыть просмотр', regulation: 'Нормативный документ',
  clearTitle: 'Нет событий для проверки', clearDescription: 'Окончательный результат сервера не содержит нарушений.',
  playbackError: 'Браузер не может воспроизвести видео либо оно недоступно. Поддержка кодеков различается, в том числе для AVI, MKV и MOV. Для просмотра попробуйте совместимый MP4 с H.264. Приём загрузки не зависит от воспроизведения в браузере; автоматической конвертации нет.',
  seekNote: 'Выберите событие для перехода к его времени в исходном видео.',
  loading: 'Загрузка…', refreshHistory: 'Обновить историю', previousPage: 'Назад', nextPage: 'Далее',
  retryConnection: 'Повторить подключение', backToUpload: 'К загрузке видео', continuesOnServer: 'Задание продолжает выполняться на сервере.',
  serverValidation: 'Размер файла и видеопоток проверяет сервер.', serverStage: 'Этап на сервере',
  queued: 'В очереди', preparing: 'Подготовка', observing: 'Наблюдение', reasoning: 'Проверка решения', evidenceStage: 'Извлечение кадров', finalizing: 'Завершение',
  analysisFailed: 'Анализ завершился ошибкой', evidenceUnavailable: 'Кадр недоступен',
  uploadUncertain: 'Сервер мог принять загрузку. Обновите историю, прежде чем отправлять файл повторно.',
  errorNetwork: 'Нет соединения с сервером. Последний известный статус сохранён.',
  errorSession: 'Сессия истекла или недоступна. Обновите подключение для восстановления доступа с текущей cookie.',
  errorCsrf: 'Нужно обновить токен сессии. Повторите действие вручную; загрузка не была отправлена повторно.',
  errorInvalidResponse: 'Сервер вернул некорректный ответ. Успешный результат показать нельзя.',
  errorInvalidUpload: 'Отправьте ровно один непустой видеофайл поддерживаемого формата.',
  errorTooLarge: 'Файл превышает лимит загрузки, установленный на сервере.',
  errorMedia: 'Сервер не смог прочитать видео. Файл может быть повреждён или использовать неподдерживаемый кодек.',
  errorUnavailable: 'Обработка недоступна. Проверьте запуск API и совместимого worker.',
  errorQueue: 'Очередь сервера заполнена. Попробуйте позже.',
  errorTimeout: 'Сервер сообщил об истечении времени выполнения задания.',
  errorInterrupted: 'Работа серверного worker была прервана. Анализ не завершён.',
  errorResult: 'Окончательное решение или его подтверждающие кадры недоступны.',
  errorNotFound: 'Этот анализ недоступен текущей сессии браузера.',
  errorFailed: 'Сервер не смог завершить анализ.',
};

const kk: Messages = {
  history: 'Талдау тарихы', historyEmpty: 'Сервердегі талдауларыңыз осында көрсетіледі.',
  hideSidebar: 'Бүйірлік мәзірді жасыру', showSidebar: 'Бүйірлік мәзірді ашу',
  analysis: 'Бейнені талдау', analysisShort: 'Талдау', results: 'Нәтижелер',
  language: 'Интерфейс тілі', lightTheme: 'Ашық тақырыпқа ауысу', darkTheme: 'Қараңғы тақырыпқа ауысу',
  uploadTitle: 'Бейнені жүктеңіз', uploadSubtitle: 'Қолма-қол ақшамен жасалатын операцияларды тексеру үшін жазбаны таңдаңыз.',
  drop: 'Бейнені осында сүйреп әкеліңіз', or: 'немесе құрылғыдан файл таңдаңыз', choose: 'Файлды таңдау',
  video: 'Бейне', supported: `Қолдау көрсетілетін пішімдер: ${VIDEO_FORMAT_DESCRIPTION}`, local: 'Бейне талдау басталғанда ғана серверге жіберіледі.',
  remove: 'Файлды жою', start: 'Талдауды бастау', invalid: `Бос емес бір бейнефайлды таңдаңыз (${VIDEO_FORMAT_DESCRIPTION}).`,
  ready: 'Жүктеуге дайын', demo: 'Демонстрациялық нәтиже', demoNotice: 'Сервер демонстрациялық өңдеуді орындайды. ЖИ қорытындылары жасалмайды.',
  upload: 'Жүктеу', processingTitle: 'Бейнені өңдеу', processingSubtitle: 'Өңдеу күйін сервер хабарлайды.',
  stageUpload: 'Бейне жүктеліп, тексерілуде…', stageAnalysis: 'Сервер нәтижесі күтілуде…',
  completed: 'Аяқталды', pending: 'Күтілуде', active: 'Орындалуда',
  resultSubtitle: 'Бейнені және серверден алынған нәтижені қараңыз.', newAnalysis: 'Жаңа талдау',
  verdictFlagged: 'Ықтимал бұзушылықтардың белгілері анықталды', verdictClear: 'Бұзушылық анықталмады',
  demoResults: 'Жасанды демонстрациялық оқиғалар. Бейне кадрлары нақты бұзушылықты дәлелдемейді.',
  recording: 'Бастапқы бейне', events: 'Оқиғалар', details: 'Оқиға мәліметтері',
  violationType: 'Бұзушылық түрі', timestamp: 'Уақыт', explanation: 'Түсіндірме', evidence: 'Оқиға кадрлары',
  evidenceNote: 'Уақыт сервер таңдаған нақты кадрларға қатысты.', frame: 'Бейне кадры', enlarge: 'Кадрды үлкейту',
  close: 'Қарауды жабу', regulation: 'Нормативтік құжат',
  clearTitle: 'Тексерілетін оқиғалар жоқ', clearDescription: 'Сервердің соңғы нәтижесінде бұзушылықтар жоқ.',
  playbackError: 'Браузер бейнені ойната алмайды немесе бейне қолжетімсіз. Кодектерді қолдау AVI, MKV және MOV үшін де әртүрлі. Көру үшін H.264 кодегі бар үйлесімді MP4 қолданып көріңіз. Жүктеуді қабылдау браузердегі ойнатуға тәуелді емес; автоматты түрлендіру жоқ.',
  seekNote: 'Бастапқы бейнедегі уақытқа өту үшін оқиғаны таңдаңыз.',
  loading: 'Жүктелуде…', refreshHistory: 'Тарихты жаңарту', previousPage: 'Артқа', nextPage: 'Келесі',
  retryConnection: 'Қайта қосылу', backToUpload: 'Бейне жүктеуге оралу', continuesOnServer: 'Тапсырма серверде орындала береді.',
  serverValidation: 'Файл өлшемі мен бейне ағынын сервер тексереді.', serverStage: 'Сервердегі кезең',
  queued: 'Кезекте', preparing: 'Дайындау', observing: 'Бақылау', reasoning: 'Шешімді тексеру', evidenceStage: 'Кадрларды шығару', finalizing: 'Аяқтау',
  analysisFailed: 'Талдау қатемен аяқталды', evidenceUnavailable: 'Кадр қолжетімсіз',
  uploadUncertain: 'Сервер жүктеуді қабылдаған болуы мүмкін. Файлды қайта жібермес бұрын тарихты жаңартыңыз.',
  errorNetwork: 'Сервермен байланыс жоқ. Соңғы белгілі күй сақталды.',
  errorSession: 'Сеанс аяқталған немесе қолжетімсіз. Ағымдағы cookie арқылы қолжетімділікті қалпына келтіру үшін қайта қосылыңыз.',
  errorCsrf: 'Сеанс токенін жаңарту қажет. Әрекетті қолмен қайталаңыз; файл қайта жіберілген жоқ.',
  errorInvalidResponse: 'Сервер қате жауап берді. Сәтті нәтижені көрсету мүмкін емес.',
  errorInvalidUpload: 'Қолдау көрсетілетін пішімдегі бос емес бір бейнефайл жіберіңіз.',
  errorTooLarge: 'Файл серверде орнатылған жүктеу шегінен асады.',
  errorMedia: 'Сервер бейнені оқи алмады. Файл зақымдалған немесе кодекке қолдау көрсетілмеуі мүмкін.',
  errorUnavailable: 'Өңдеу қолжетімсіз. API мен үйлесімді worker іске қосылғанын тексеріңіз.',
  errorQueue: 'Сервер кезегі толы. Кейінірек қайталаңыз.',
  errorTimeout: 'Сервер тапсырманың орындалу уақыты аяқталғанын хабарлады.',
  errorInterrupted: 'Сервердегі worker жұмысы үзілді. Талдау аяқталмады.',
  errorResult: 'Соңғы шешім немесе оны растайтын кадрлар қолжетімсіз.',
  errorNotFound: 'Бұл талдау ағымдағы браузер сеансына қолжетімсіз.',
  errorFailed: 'Сервер талдауды аяқтай алмады.',
};

export type Language = 'ru' | 'kk' | 'en';
export type MessageKey = keyof Messages;
const dictionaries = { ru, kk, en };
const errors: Record<string, MessageKey> = {
  NETWORK_ERROR: 'errorNetwork', SERVER_UNAVAILABLE: 'errorNetwork',
  UNAUTHORIZED: 'errorSession', CSRF_REJECTED: 'errorCsrf', INVALID_RESPONSE: 'errorInvalidResponse',
  INVALID_UPLOAD: 'errorInvalidUpload', UNSUPPORTED_EXTENSION: 'errorInvalidUpload', UPLOAD_TOO_LARGE: 'errorTooLarge',
  INVALID_MEDIA: 'errorMedia', MEDIA_UNAVAILABLE: 'errorUnavailable', ML_NOT_CONFIGURED: 'errorUnavailable',
  PIPELINE_DISABLED: 'errorUnavailable', WORKER_UNAVAILABLE: 'errorUnavailable', QUEUE_FULL: 'errorQueue',
  JOB_TIMEOUT: 'errorTimeout', WORKER_INTERRUPTED: 'errorInterrupted', INVALID_RESULT: 'errorResult',
  EVIDENCE_FAILED: 'errorResult', ARTIFACT_UNAVAILABLE: 'errorResult', NOT_FOUND: 'errorNotFound',
};
export const errorMessageKey = (code: string): MessageKey => errors[code] ?? 'errorFailed';
const stages: Record<string, MessageKey> = { queued: 'queued', preparing: 'preparing', observing: 'observing', reasoning: 'reasoning', evidence: 'evidenceStage', finalizing: 'finalizing' };
export const stageMessageKey = (stage: string): MessageKey | undefined => stages[stage];
const I18nContext = createContext<{ language: Language; setLanguage: (value: Language) => void; t: (key: MessageKey) => string } | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('ru');
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <I18nContext.Provider value={{ language, setLanguage, t: key => dictionaries[language][key] }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18nProvider is required');
  return context;
}
