import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const en = {
  analysis: 'Video analysis', analysisShort: 'Analysis', results: 'Results',
  language: 'Interface language', lightTheme: 'Use light theme', darkTheme: 'Use dark theme',
  uploadTitle: 'Upload a video', uploadSubtitle: 'Select a recording to review cash-handling activity.',
  drop: 'Drag and drop your video here', or: 'or select a file from your device', choose: 'Choose file',
  supported: 'Supported format: .mov', local: 'Your video stays on this device.',
  remove: 'Remove file', start: 'Start analysis', invalid: 'Select one non-empty .mov video file.',
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
  playbackError: 'This MOV encoding cannot be played in this browser. Try a MOV file encoded with H.264.',
  seekNote: 'Demo timestamps are adjusted to the available video duration.',
};

type Messages = { [K in keyof typeof en]: string };
const ru: Messages = {
  analysis: 'Анализ видео', analysisShort: 'Анализ', results: 'Результаты',
  language: 'Язык интерфейса', lightTheme: 'Включить светлую тему', darkTheme: 'Включить тёмную тему',
  uploadTitle: 'Загрузите видео', uploadSubtitle: 'Выберите запись для проверки операций с наличными.',
  drop: 'Перетащите видео сюда', or: 'или выберите файл на устройстве', choose: 'Выбрать файл',
  supported: 'Поддерживаемый формат: .mov', local: 'Видео остаётся на вашем устройстве.',
  remove: 'Удалить файл', start: 'Начать анализ', invalid: 'Выберите один непустой видеофайл .mov.',
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
  playbackError: 'Браузер не поддерживает кодировку этого MOV. Попробуйте MOV-файл с кодеком H.264.',
  seekNote: 'Демонстрационные отметки времени адаптированы к длительности видео.',
};

const kk: Messages = {
  analysis: 'Бейнені талдау', analysisShort: 'Талдау', results: 'Нәтижелер',
  language: 'Интерфейс тілі', lightTheme: 'Ашық тақырыпқа ауысу', darkTheme: 'Қараңғы тақырыпқа ауысу',
  uploadTitle: 'Бейнені жүктеңіз', uploadSubtitle: 'Қолма-қол ақшамен жасалатын операцияларды тексеру үшін жазбаны таңдаңыз.',
  drop: 'Бейнені осында сүйреп әкеліңіз', or: 'немесе құрылғыдан файл таңдаңыз', choose: 'Файлды таңдау',
  supported: 'Қолдау көрсетілетін пішім: .mov', local: 'Бейне құрылғыңызда қалады.',
  remove: 'Файлды жою', start: 'Талдауды бастау', invalid: 'Бос емес бір .mov бейнефайлын таңдаңыз.',
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
  playbackError: 'Браузер осы MOV кодтауын қолдамайды. H.264 кодегі бар MOV файлын қолданып көріңіз.',
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
