# Sources and planning references

Reviewed: **2026-08-25**.

These references provide **planning context for the PR2 what-if simulator only**. They are not legal, pension, tax, investment, employment, or fee-negotiation advice. Pension Lab does not infer a user's regulatory entitlement, fund subtype, or personal agreement from these references.

## Simulator source metadata

The application stores the following reviewed metadata locally in `app/simulator-config.js`. It never fetches a source while a user moves a control.

| Topic | Reviewed fact used in the UI | Official reference |
| --- | --- | --- |
| Inflation | The Bank of Israel's annual price-stability target is **1%–3%**. The simulator's immutable baseline is 2%. | [Bank of Israel – monetary policy framework](https://www.boi.org.il/roles/monetary-policy/conducting-monetary-policy/) |
| Pension contributions | General context describes employee contributions of **6%–7%**, employer contributions of at least **6.5%**, and severance of **6%–8.33%**. The simulator's 18.5%–21.83% band is a reference range, not a universal legal limit. | [Ministry of Finance – choosing pension savings](https://haotzarsheli.mof.gov.il/Subject/Pages/Choosing-pension-saving.aspx) |
| Management fees | New comprehensive pension funds may charge up to **6% from deposits** and **0.5% annually from balance**. General pension funds may charge from balance only, up to **2% annually**. PR2 does not infer which subtype applies to a report. | [Capital Market Authority – PensiaNet concepts](https://www.pensyanet.cma.gov.il/Home/Concepts) |
| Selected pension funds | The 2024–2028 selection decision states a cap of **1% from deposits** and **0.22% from balance** for the joining terms described there, guaranteed for **10 years** from joining. This is a reference point, not a personal entitlement. | [Ministry of Finance – fourth selected-fund procedure](https://www.gov.il/BlobFolder/dynamiccollectorresultitem/notice-2024-101/he/Results_of_the_fourth_procedure_for_determining_selected_funds_pdf.pdf) |
| Return assurance | The mechanism that replaced designated bonds refers to a **5.15% CPI-linked annual return** for the relevant approximately **30%** asset tranche. It is educational context only and is not used by the PR2 projection model. | [Capital Market Authority – return-assurance regulation materials](https://www.gov.il/he/pages/regulation_0009) |

## PR2 model boundaries

- A trusted `new_pension` report state and the existing years-until-retirement answer are required before the simulator is shown. Old-pension and unknown-fund routes remain blocked.
- The immutable baseline keeps the existing PR1 assumptions: 4% real return, 2% inflation, coefficient 200, the report-derived monthly contribution, and the report's personal fees. The displayed nominal equivalent is exactly `(1 + 0.04) × (1 + 0.02) − 1 = 6.08%`.
- The selected scenario uses the same projection engine. Its real return is always calculated as `(1 + nominal return) / (1 + inflation) − 1`, never as simple subtraction.
- Green on a track means a central comparison range. It does **not** mean a financially good outcome, and amber/red edges do **not** mean an impossible scenario.
- A contribution-rate control is available only when the report has a reliable or manually confirmed average pension salary. Otherwise PR2 exposes an amount-only, 50%–150% simulation around the confirmed monthly contribution and does not fabricate a salary or a salary percentage.
- What-if control values are in-memory UI state only. They are not saved to session storage, localStorage, IndexedDB, a backend, analytics, or a network request.
