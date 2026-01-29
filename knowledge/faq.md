# FAQ

Q: What does this tool do?
A: It estimates voyage profit and TCE for a single vessel-cargo pairing and evaluates laycan feasibility.

Q: Where do distances come from?
A: From the port distance table in /public/business_data/port_data/port_distances.csv, with a default fallback if missing.

Q: What is laycan feasibility?
A: It checks whether ETA at load port falls within the laycan window. Early arrival can add waiting cost; late arrival is infeasible.

Q: Can I change assumptions?
A: Yes. You can adjust bunker prices and vessel departure dates in the Manual Calculator.
