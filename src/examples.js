/** Executable FixtureLang 0.1 examples; mirrored in examples/*.fixture. */
export const EXAMPLES = [
  {
    id: 'importer-edges',
    title: 'Importer edge cases',
    description: 'Related tables with deliberate duplicate IDs, omitted properties and explicit nulls.',
    source: String.raw`# Faults are part of the fixture, not generation failures.
fixture importer_edges seed 2026 {
  table people rows 12 {
    id: id = seq(1) duplicate every 4;
    name: string = text("Person ");
    email: string = pick("ada@example.test", "lin@example.test", "sam@example.test") missing every 4;
    nickname: string = pick("Ada", "Lin", "Sam") null every 3;
    active: bool = bool(75);
  }

  table signups rows 18 {
    id: id = seq(100);
    person_id: id = ref(people.id);
    seats: int = int(1, 4);
    starts: date = date("2026-07-18", "2026-08-01");
  }
}`,
  },
  {
    id: 'related-orders',
    title: 'Related orders',
    description: 'A minimal typed parent/child fixture, reproducible with one explicit seed.',
    source: String.raw`fixture shop seed 42 {
  table customers rows 6 {
    id: id = seq(1);
    name: string = text("Customer ");
    tier: string = pick("free", "pro", "team");
  }
  table orders rows 12 {
    id: id = seq(1001);
    customer_id: id = ref(customers.id);
    total_cents: int = int(0, 25000);
    paid: bool = bool(80);
    placed: date = date("2024-02-28", "2024-03-02");
  }
}`,
  },
  {
    id: 'csv-boundaries',
    title: 'CSV boundaries',
    description: 'Quoted commas, newlines, Unicode and formula-like strings. Compare raw and spreadsheet-safe CSV.',
    source: String.raw`# Raw CSV preserves the exact strings. Choose spreadsheet mode
# before opening formula-like text in a spreadsheet application.
fixture csv_boundaries seed 7 {
  table payloads rows 16 {
    id: id = seq(1);
    formula: string = pick("=1+1", "+SUM(1,2)", "-1+2", "@SUM(A1)", "\tplain", "  =2+2");
    quoted: string = pick("comma,inside", "say \"hello\"", "line one\nline two", "snowman ☃");
    empty: string = pick("");
    missing: string = pick("present") missing every 2;
    nullable: string = pick("present") null every 3;
    negative: int = int(-9, -1);
  }
}`,
  },
  {
    id: 'bounded-workload',
    title: 'Bounded workload',
    description: '20,000 rows and 200,000 cells: the fixed row/cell budgets. Run, then cancel.',
    source: String.raw`# Exactly the row and cell budgets; useful for cancellation.
fixture workload seed 123456789 {
  table users rows 10000 {
    id: id = seq(1);
    name: string = text("User ");
    region: string = pick("north", "south", "east", "west");
    score: int = int(0, 1000000);
    active: bool = bool(70);
    joined: date = date("2000-01-01", "2026-10-26");
    label: string = pick("alpha", "beta", "gamma");
    note: string = text("row-") missing every 10;
    quota: int = int(1, 1000);
    optional: string = pick("value") null every 7;
  }
  table events rows 10000 {
    id: id = seq(1);
    user_id: id = ref(users.id);
    kind: string = pick("open", "save", "close");
    amount: int = int(-1000, 1000);
    accepted: bool = bool(90);
    happened: date = date("2020-01-01", "2026-10-26");
    label: string = text("Event ");
    source: string = pick("web", "mobile");
    attempt: int = int(1, 5);
    comment: string = text("comment-") missing every 3;
  }
}`,
  },
];
