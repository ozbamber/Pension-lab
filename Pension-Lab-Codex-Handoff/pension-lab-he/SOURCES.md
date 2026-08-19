# Sources and planning references

Reviewed: **2026-08-18**.

These references provide **context for the interface only**. They are not legal, pension, tax or investment advice, and the calculation engine does not determine an individual saver's regulatory entitlement.

## Statutory retirement-age default

The onboarding uses birth year and the selected statutory track only to suggest an editable default retirement age. The current table follows Israel's National Insurance Institute: age 67 for men; for women, a gradual increase from age 62 to 65 by birth year, reaching age 65 for January 1970 onward.

- https://www.btl.gov.il/benefits/old_age/Conditions_of_eligibility/gilMezake/Pages/gilPrisha.aspx
- https://www.btl.gov.il/benefits/old_age/Pages/RetirementCalculation.aspx

The interface does not calculate benefit eligibility. Users can change the retirement age used by the projection.

## Israel inflation target

The Bank of Israel defines price stability as annual inflation within a **1%–3%** range. The simulator therefore shows 1%–3% as planning context while leaving inflation fully editable.

- https://www.boi.org.il/en/bank-of-israel/about-the-bank-of-israel/objectives-and-functions/
- https://www.boi.org.il/media/jybpi3rm/%D7%9E%D7%95%D7%A0%D7%99%D7%98%D7%A8%D7%99%D7%AA-%D7%9E%D7%97%D7%A6%D7%99%D7%AA-%D7%A8%D7%90%D7%A9%D7%95%D7%A0%D7%94-2026.pdf

## Pension return-assurance mechanism

The 2021 legislation and implementation materials replaced designated pension bonds with a return-assurance mechanism whose reference rate is a **5.15% annual real return**. The original framework referred to **30% of pension-fund assets**.

Subsequent official materials show that the **allocation among savers and investment tracks is not safely represented by one universal 30% assumption**:

- A 2024 proposal described age- and track-dependent allocation and a temporary extension through the end of 2025.
- A 2025 draft proposed, among other changes, allocating 40% to certain savers aged 60 and over instead of the previously proposed 30% allocation for savers aged 50 and over.

Because these rules can depend on age, track, transition provisions and final regulation, the simulator exposes the protected weight as an editable **planning parameter**. Its 30% default is an example, not a calculation of legal eligibility. Users should verify the rules applicable to their own fund and projection date.

Official references:

- Original mechanism and 5.15% real target: https://www.gov.il/he/pages/regulation_0005
- 2024 allocation proposal and temporary extension: https://main.knesset.gov.il/News/PressReleases/Pages/PRESS29.12.24A.aspx
- 2025 allocation draft: https://www.gov.il/he/pages/regulation_0063
- 2024 implementation report: https://fs.knesset.gov.il/25/SecondaryLaw/25_scl_rp_6135446.pdf

## Return assumptions

The 4%–6% real range shown in the interface is deliberately labeled a **planning range**, not a forecast. Users can enter other assumptions and split them into multiple phases.
