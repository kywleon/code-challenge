# Problem 4: Sum to N

## Problem Description

Implement a function to compute the sum of all integers from 1 to n (inclusive).

**Input**: `n` - any integer

**Output**: return the result of 1 + 2 + 3 + ... + n

**Assumption**: result is always less than `Number.MAX_SAFE_INTEGER`

### Examples

```
sum_to_n_a(5)  // => 15 (1 + 2 + 3 + 4 + 5)
sum_to_n_a(1)  // => 1
sum_to_n_a(0)  // => 1 (0 + 1)
sum_to_n_a(-2) // => -2 (-2 + -1 + 0 + 1)
```

---

## Three Implementations

### 1. `sum_to_n_a` — Iterative Approach

**Implementation**: Use a `for` loop to accumulate values sequentially.

```typescript
export function sum_to_n_a(n: number): number {
  n = Math.trunc(n);
  if (n >= 1) {
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += i;
    return sum;
  }
  let sum = 0;
  for (let i = n; i <= 1; i++) sum += i;
  return sum;
}
```

**Complexity Analysis**:
- **Time**: O(|n|) — loops through |n| iterations
- **Space**: O(1) — uses only a constant number of variables
- **Pros**: Simple, easy to understand, no stack overflow risk
- **Cons**: Linear time; poor performance for large |n|

---

### 2. `sum_to_n_b` — Recursive Approach

**Implementation**: Decompose the problem into `n + sum_to_n(n-1)` or `n + sum_to_n(n+1)`.

```typescript
export function sum_to_n_b(n: number): number {
  n = Math.trunc(n);
  if (n === 1) return 1;
  if (n > 1) return n + sum_to_n_b(n - 1);
  return n + sum_to_n_b(n + 1);
}
```

**Complexity Analysis**:
- **Time**: O(|n|) — recursion depth is |n|
- **Space**: O(|n|) — call stack depth is |n|
- **Pros**: Elegant code, demonstrates divide-and-conquer approach
- **Cons**: Risk of stack overflow for large |n|; slower than iteration

---

### 3. `sum_to_n_c` — Formula Approach (Constant Time)

**Implementation**: Use the arithmetic series formula for direct calculation.

```typescript
export function sum_to_n_c(n: number): number {
  n = Math.trunc(n);
  if (n >= 1) return (n * (n + 1)) / 2;
  const count = 2 - n; // number of terms from n to 1
  return ((n + 1) * count) / 2;
}
```

**Formula Derivation** (n ≥ 1):
- Sum = 1 + 2 + ... + n = n*(n+1)/2

**Complexity Analysis**:
- **Time**: O(1) — constant time; direct formula calculation
- **Space**: O(1) — uses only constant space
- **Pros**: Most efficient; instant computation for any n
- **Cons**: None (this is the optimal solution)

---

## Performance Comparison

| Approach | Time Complexity | Space Complexity | Use Case |
|----------|-----------------|------------------|----------|
| a (Iterative) | O(\|n\|) | O(1) | Medium-sized n; good for learning |
| b (Recursive) | O(\|n\|) | O(\|n\|) | Small n; demonstrates recursion |
| c (Formula) | O(1) | O(1) | **Recommended for production** — any n |

---

## How to Run Tests

### Prerequisites

Install dependencies in the repository root:

```powershell
npm install
```

### Running Tests

From the repository root:

```powershell
npm run test:problem4
```

Or directly in this directory:

```powershell
npx ts-node --project ../../tsconfig.json run_tests.ts
```

### Sample Output

```
OK: sum_to_n_a(5) => 15
OK: sum_to_n_b(5) => 15
OK: sum_to_n_c(5) => 15
OK: sum_to_n_a(1) => 1
... [more test cases] ...
All tests passed.
```

---

## File Structure

```
problem4/
  ├─ sum_to_n.ts        # Source code for three implementations
  ├─ run_tests.ts       # Test script
  └─ README.md          # This file
```

---

## Summary

- **a (Iterative)** — Beginner-friendly, easy to understand the underlying logic
- **b (Recursive)** — Demonstrates recursion in algorithm design
- **c (Formula)** — **Optimal solution**, recommended for production use

All three approaches have passed unit tests, verifying their correctness.
