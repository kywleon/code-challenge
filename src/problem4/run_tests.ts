import { sum_to_n_a, sum_to_n_b, sum_to_n_c } from './sum_to_n.ts';

function assertEqual(actual: number, expected: number, msg: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${msg} => expected ${expected}, got ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${msg} => ${actual}`);
  }
}

const cases: Array<{ n: number; expected: number }> = [
  { n: 5, expected: 15 },
  { n: 1, expected: 1 },
  { n: 0, expected: 1 },
  { n: -2, expected: -2 },
  { n: 10, expected: 55 },
];

for (const { n, expected } of cases) {
  assertEqual(sum_to_n_a(n), expected, `sum_to_n_a(${n})`);
  assertEqual(sum_to_n_b(n), expected, `sum_to_n_b(${n})`);
  assertEqual(sum_to_n_c(n), expected, `sum_to_n_c(${n})`);
}

if (process.exitCode === 0 || process.exitCode === undefined) console.log('All tests passed.');
