(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PensionSimulatorConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key], seen));
    return Object.freeze(value);
  }

  function percentText(ratio, digits = 0) {
    const numeric = Number(ratio) * 100;
    const fixed = numeric.toFixed(digits);
    return `${fixed.replace(/(?:\.0+|(?<=\.\d*[1-9])0+)$/, '')}%`;
  }

  const REVIEWED_DATE = '2026-08-25';
  const BASELINE = {
    realReturnRate: 0.04,
    inflationRate: 0.02,
    coefficient: 200,
  };
  BASELINE.nominalReturnRate = Number(((1 + BASELINE.realReturnRate) * (1 + BASELINE.inflationRate) - 1).toFixed(4));

  const SOURCES = {
    inflationTarget: {
      id: 'inflationTarget',
      label: 'יעד האינפלציה',
      reviewedDate: REVIEWED_DATE,
      sourceOrganization: 'בנק ישראל',
      sourceTitle: 'מסגרת המדיניות המוניטרית',
      sourceUrl: 'https://www.boi.org.il/roles/monetary-policy/conducting-monetary-policy/',
      note: 'יעד יציבות המחירים השנתי מוגדר כיום כתחום של 1%–3%.',
    },
    pensionContributions: {
      id: 'pensionContributions',
      label: 'שיעורי הפקדה כלליים',
      reviewedDate: REVIEWED_DATE,
      sourceOrganization: 'משרד האוצר – האוצר שלי',
      sourceTitle: 'בחירת חיסכון פנסיוני',
      sourceUrl: 'https://haotzarsheli.mof.gov.il/Subject/Pages/Choosing-pension-saving.aspx',
      note: 'הדף מתאר הפרשות עובד של 6%–7%, תגמולי מעסיק של לפחות 6.5% ופיצויים של 6%–8.33%.',
    },
    pensionFeeCaps: {
      id: 'pensionFeeCaps',
      label: 'דמי ניהול בקרנות פנסיה',
      reviewedDate: REVIEWED_DATE,
      sourceOrganization: 'רשות שוק ההון – פנסיה נט',
      sourceTitle: 'מושגים בפנסיה נט: דמי ניהול',
      sourceUrl: 'https://www.pensyanet.cma.gov.il/Home/Concepts',
      note: 'קרן פנסיה חדשה רשאית לגבות עד 6% מההפקדות ועד 0.5% מהצבירה בשנה; קרן פנסיה כללית גובה מהצבירה בלבד עד 2% בשנה.',
    },
    selectedFunds: {
      id: 'selectedFunds',
      label: 'קרנות פנסיה נבחרות 2024–2028',
      reviewedDate: REVIEWED_DATE,
      sourceOrganization: 'משרד האוצר',
      sourceTitle: 'תוצאות ההליך הרביעי לקביעת קרנות נבחרות',
      sourceUrl: 'https://www.gov.il/BlobFolder/dynamiccollectorresultitem/notice-2024-101/he/Results_of_the_fourth_procedure_for_determining_selected_funds_pdf.pdf',
      note: 'למצטרפים במסגרת התנאים המתוארים: עד 1% מההפקדות ועד 0.22% מהצבירה, מובטחים ל-10 שנים ממועד ההצטרפות.',
    },
    returnAssurance: {
      id: 'returnAssurance',
      label: 'מנגנון הבטחת תשואה',
      reviewedDate: REVIEWED_DATE,
      sourceOrganization: 'רשות שוק ההון, ביטוח וחיסכון',
      sourceTitle: 'טיוטת תקנות – הבטחת היציבות בתשואות קרנות הפנסיה',
      sourceUrl: 'https://www.gov.il/he/pages/regulation_0009',
      note: 'המנגנון שהחליף את האג"ח המיועדות מתייחס לכ-30% מנכסי קרנות הפנסיה ומציין תשואה שנתית של 5.15% צמודת מדד עבור החלק הרלוונטי.',
    },
  };

  const SLIDERS = {
    nominalReturn: {
      id: 'nominalReturn',
      label: 'תשואה נומינלית',
      unit: 'percent',
      min: 0.02,
      max: 0.12,
      step: 0.001,
      centralMin: 0.04,
      centralMax: 0.08,
      moderateMin: 0.03,
      moderateMax: 0.09,
      baselineValue: BASELINE.nominalReturnRate,
      tickDigits: 0,
      valueDigits: 1,
      sourceIds: ['returnAssurance'],
      info: {
        title: 'תשואה נומינלית',
        paragraphs: [
          'תשואה נומינלית היא התשואה לפני אינפלציה.',
          `נקודת הבסיס ${percentText(BASELINE.nominalReturnRate, 2)} נומינלית שקולה בדיוק ל-${percentText(BASELINE.realReturnRate)} ריאלית עם ${percentText(BASELINE.inflationRate)} אינפלציה.`,
          `${percentText(0.04)}–${percentText(0.08)} הוא טווח להשוואת תרחישים, לא תחזית רשמית. תשואות עבר אינן מבטיחות תשואות עתידיות.`,
          'להקשר בלבד: מנגנון הבטחת התשואה החליף את האג"ח המיועדות בשנת 2022 ומתייחס לחלק הרלוונטי של כ-30% מהנכסים. הוא אינו אומר שכל קרן הפנסיה צוברת 5.15% ריאלית.',
        ],
      },
    },
    inflation: {
      id: 'inflation',
      label: 'אינפלציה',
      unit: 'percent',
      min: 0,
      max: 0.1,
      step: 0.001,
      centralMin: 0.01,
      centralMax: 0.03,
      moderateMin: 0.005,
      moderateMax: 0.04,
      baselineValue: BASELINE.inflationRate,
      tickDigits: 0,
      valueDigits: 1,
      sourceIds: ['inflationTarget'],
      info: {
        title: 'אינפלציה',
        paragraphs: [
          'זהו שיעור האינפלציה השנתי בתרחיש.',
          'יעד יציבות המחירים של בנק ישראל הוא 1%–3% לשנה; נקודת הבסיס של Pension Lab היא 2%.',
          'כאשר התשואה הנומינלית קבועה, אינפלציה גבוהה יותר מפחיתה את התשואה הריאלית ואת ערך הכסף במונחי היום.',
        ],
      },
    },
    contributionRate: {
      id: 'contribution',
      label: 'שיעור ההפקדה לפנסיה',
      unit: 'percent',
      min: 0.15,
      max: 0.24,
      step: 0.001,
      centralMin: 0.185,
      centralMax: 0.2183,
      moderateMin: 0.17,
      moderateMax: 0.23,
      tickDigits: 2,
      valueDigits: 2,
      sourceIds: ['pensionContributions'],
      info: {
        title: 'שיעור ההפקדה לפנסיה',
        paragraphs: [
          'השיעור כולל יחד את הפקדות העובד, המעסיק ורכיב הפיצויים.',
          'הסכום החודשי בתרחיש מחושב לפי השכר המדווח לפנסיה בדוח. הטווח 18.5%–21.83% הוא נקודת ייחוס כללית בלבד; הסכמים אישיים, ענפיים וקיבוציים יכולים להיות שונים.',
          'הזזת הסמן היא סימולציה ואינה הוראה למעסיק.',
        ],
      },
    },
    monthlyContribution: {
      id: 'contribution',
      label: 'הפקדה חודשית',
      unit: 'multiplier',
      min: 0.5,
      max: 1.5,
      step: 0.01,
      centralMin: 0.8,
      centralMax: 1.2,
      moderateMin: 0.65,
      moderateMax: 1.35,
      baselineValue: 1,
      tickDigits: 0,
      valueDigits: 0,
      sourceIds: [],
      info: {
        title: 'הפקדה חודשית',
        paragraphs: [
          'השכר המדווח הממוצע אינו זמין או אינו מספיק אמין לחישוב שיעור הפקדה מתוך שכר.',
          'לכן הסימולטור משנה רק את סכום ההפקדה החודשי שאושר בדוח, סביב נקודת בסיס של 100%. זה אינו שיעור מהשכר ואינו כולל נקודת ייחוס רגולטורית.',
        ],
      },
    },
    depositFee: {
      id: 'depositFee',
      label: 'מהפקדה',
      unit: 'percent',
      min: 0,
      max: 0.06,
      step: 0.0005,
      centralMin: 0.005,
      centralMax: 0.025,
      moderateMin: 0.0025,
      moderateMax: 0.035,
      tickDigits: 1,
      valueDigits: 2,
      sourceIds: ['pensionFeeCaps', 'selectedFunds'],
      info: {
        title: 'דמי ניהול מהפקדה',
        paragraphs: [
          'זהו שיעור שנוכה מכל הפקדה לפני שהיא מצטרפת לצבירה.',
          'המסילה היא טווח סימולציה. לקרן פנסיה חדשה מקיפה התקרה המתוארת במקור היא עד 6% מההפקדות ועד 0.5% מהצבירה; בקרן פנסיה כללית דמי הניהול נגבים מהצבירה בלבד עד 2% בשנה. הסוג המדויק אינו מזוהה כאן, ולכן אין להסיק שתקרה מסוימת חלה על הדוח הזה.',
          'בקרנות הנבחרות לתקופה 2024–2028 מופיעה נקודת ייחוס של עד 1% מההפקדות ועד 0.22% מהצבירה, בתנאי ההצטרפות המתוארים ול-10 שנים. זו נקודת ייחוס, לא התחייבות אישית.',
        ],
      },
    },
    balanceFee: {
      id: 'balanceFee',
      label: 'מצבירה',
      unit: 'percent',
      min: 0,
      max: 0.02,
      step: 0.0001,
      centralMin: 0.0005,
      centralMax: 0.003,
      moderateMin: 0.0002,
      moderateMax: 0.0045,
      tickDigits: 2,
      valueDigits: 2,
      sourceIds: ['pensionFeeCaps', 'selectedFunds'],
      info: {
        title: 'דמי ניהול מצבירה',
        paragraphs: [
          'זהו שיעור שנתי שנוכה מהכסף שכבר נצבר.',
          'המסילה היא טווח סימולציה. לקרן פנסיה חדשה מקיפה התקרה המתוארת במקור היא עד 6% מההפקדות ועד 0.5% מהצבירה; בקרן פנסיה כללית דמי הניהול נגבים מהצבירה בלבד עד 2% בשנה. הסוג המדויק אינו מזוהה כאן, ולכן אין להסיק שתקרה מסוימת חלה על הדוח הזה.',
          'בקרנות הנבחרות לתקופה 2024–2028 מופיעה נקודת ייחוס של עד 1% מההפקדות ועד 0.22% מהצבירה, בתנאי ההצטרפות המתוארים ול-10 שנים. זו נקודת ייחוס, לא התחייבות אישית.',
        ],
      },
    },
  };

  const COPY = {
    simulatorTitle: 'בדקו איך שינויים משפיעים על הפנסיה',
    centralRangeLegend: 'ירוק מסמן טווח הנחות מרכזי. הקצוות מאפשרים לבחון תרחישי קיצון.',
    reset: 'חזרה לבסיס',
    baseline: 'בסיס',
    selected: 'בחירה',
    centralStatus: 'בתוך טווח ההנחות המרכזי',
    moderateStatus: 'מחוץ לטווח המרכזי',
    extremeStatus: 'תרחיש קיצון',
  };

  return deepFreeze({
    REVIEWED_DATE,
    BASELINE,
    SOURCES,
    SLIDERS,
    COPY,
    SLIDER_POSITION_MAX: 10000,
  });
});
