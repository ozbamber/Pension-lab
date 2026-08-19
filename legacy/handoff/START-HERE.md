# Pension Lab — START HERE

זהו handoff מלא לפרויקט Pension Lab בעברית וב-RTL.

## מה יש כאן

- `pension-lab-he/` — קוד המקור העדכני.
- `pension-lab-he-standalone.html` — גרסה עצמאית בקובץ HTML יחיד, לפתיחה ישירה בדפדפן.
- `AGENTS.md` — הוראות מחייבות לכל Coding Agent שממשיך את העבודה.
- `CODEX-HANDOFF.md` — מצב הפרויקט, החלטות שכבר התקבלו ויעד ההמשך.
- `CODEX-PROMPT.txt` — prompt מוכן להדבקה ל-Codex/Agent.
- `DEPLOYMENT-NEXT.md` — מסלול ההפצה המומלץ כרגע ללא עלות.
- `CHECKSUMS.txt` — checksums של החבילה הקודמת.
- `_archive/original-upload.zip` — הקובץ המקורי שהועלה, לצורכי היסטוריה בלבד.

## מצב נוכחי

ה-MVP עובד, בעברית מלאה וב-RTL. הוא כולל בין היתר גיל נוכחי/פרישה, יתרה ושכר, שכר מבוטח, הפקדות באחוזים או סכום, שלבי שכר ותשואה, אינפלציה, הפסקות עבודה, דמי ניהול, מקדם קצבה, שקלים של היום/עתידיים, גרפי צבירה, Explorer לגיל פרישה, תרחישים ושמירה ב-localStorage.

בוצע סבב תיקונים נוסף שכלל חיזוק מנוע החישוב, טיפול נכון בשלבים מעבר לגבול האחרון, פירוק הפקדות/דמי ניהול, fallback כאשר localStorage אינו זמין, שיפורי mobile/RTL ונגישות, ותהליך build לקובץ העצמאי.

## בדיקות

- 23 בדיקות מנוע עברו בהצלחה בסבב האחרון.
- בוצע Browser QA ב-Chromium לדסקטופ ולמובייל.
- לא נמצאו שגיאות JavaScript/Console בסבב האחרון.
- אין להניח שבדיקות Safari/Firefox או screen reader בוצעו — אלה עדיין מחוץ להיקף ה-QA המתועד.

## איך להתחיל

לקריאה ראשונה: `CODEX-HANDOFF.md`, ואז `AGENTS.md`.

לפיתוח: עבוד מתוך `pension-lab-he/` ולא מתוך קובץ ה-standalone.
