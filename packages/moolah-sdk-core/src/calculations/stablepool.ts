/**
 * StableSwap Pool calculations (Curve AMM)
 * @see https://classic.curve.fi/files/stableswap-paper.pdf
 */

const WEI_VALUE = 10n ** 18n;
const PRECISION = 1n;

/**
 * Calculate the constant D of Curve AMM formula
 */
export function getD({
    amplifier,
    balances,
}: {
    amplifier: bigint;
    balances: bigint[];
}): bigint {
    const numOfCoins = balances.length;
    if (numOfCoins <= 1) {
        throw new Error('To get constant D, pool should have at least two coins.');
    }

    const sum = balances.reduce<bigint>((s, cur) => s + BigInt(cur), 0n);
    if (sum === 0n) {
        return 0n;
    }

    const n = BigInt(numOfCoins);
    const ann = BigInt(amplifier) * n;
    let dPrev = 0n;
    let d = sum;
    for (let i = 0; i < 255; i += 1) {
        let dp = d;
        for (const b of balances) {
            dp = (dp * d) / (BigInt(b) * n + 1n);
        }
        dPrev = d;
        d = ((ann * sum + dp * n) * d) / ((ann - 1n) * d + (n + 1n) * dp);

        if (d > dPrev && d - dPrev <= PRECISION) {
            break;
        }

        if (d <= dPrev && dPrev - d <= PRECISION) {
            break;
        }
    }

    return d;
}

/**
 * Calculate LP output from adding liquidity
 */
export function getLPOutput({
    amplifier,
    balances,
    amounts,
    totalSupply,
    fee,
}: {
    amplifier: bigint;
    balances: bigint[];
    amounts: bigint[];
    totalSupply: bigint;
    fee: bigint;
}): bigint {
    if (amounts.length !== balances.length) {
        throw new Error('amounts length must be equal to balances length');
    }

    const newBalances = balances.map(
        (balance, index) => balance + amounts[index],
    );

    if (totalSupply === 0n || balances.every(x => x === 0n)) {
        return getD({ amplifier, balances: newBalances });
    }

    const d0 = getD({ amplifier, balances });
    const d1 = getD({ amplifier, balances: newBalances });

    const n = BigInt(balances.length);
    const eachTokenFee = (fee * n) / 4n / (n - 1n);

    for (const [i, b] of balances.entries()) {
        const idealBalance = (d1 * b) / d0;
        let diff = 0n;
        if (idealBalance > newBalances[i]) {
            diff = idealBalance - newBalances[i];
        } else {
            diff = newBalances[i] - idealBalance;
        }
        const feeAmount = (eachTokenFee * diff) / WEI_VALUE;
        newBalances[i] -= feeAmount;
    }
    const d2 = getD({ amplifier, balances: newBalances });

    const expectedMintLP = (totalSupply * (d2 - d0)) / d0;

    return expectedMintLP;
}

/**
 * Calculate D after withdraw
 */
export function getDAfterWithdraw({
    d,
    withdrawLp,
    totalSupply,
}: {
    d: bigint;
    withdrawLp: bigint;
    totalSupply: bigint;
}): bigint {
    return ((totalSupply - withdrawLp) * d) / totalSupply;
}

/**
 * Calculate x[i] if one reduces D from being calculated for xp to D
 */
export function getYD({
    d: _d,
    amplifier,
    balances,
    idx,
}: {
    d?: bigint;
    amplifier: bigint;
    balances: bigint[];
    idx: number;
}): bigint {
    if (idx >= balances.length || idx < 0) {
        throw new Error('idx is out of bounds');
    }

    const n = BigInt(balances.length);
    const d = _d ?? getD({ amplifier, balances });
    let c = d;
    let s_ = 0n;
    const ann = amplifier * n;

    let _x = 0n;
    for (let i = 0; i < balances.length; i++) {
        if (i !== idx) {
            _x = balances[i];
            s_ += _x;
            c = (c * d) / (_x * n);
        }
    }
    c = (c * d) / ann / n;
    const b = s_ + d / ann;
    let xPrev = 0n;
    let x = d;

    for (let i = 0; i < 255; i++) {
        xPrev = x;
        x = (x * x + c) / (2n * x + b - d);
        if (x > xPrev && x - xPrev <= PRECISION) {
            break;
        }
        if (x < xPrev && xPrev - x <= PRECISION) {
            break;
        }
    }

    return x;
}

/**
 * Get max single token withdraw amount
 */
export function getMaxX(
    {
        d,
        amplifier,
        balances,
        withdrawLp,
        totalSupply,
        fee,
    }: {
        d?: bigint;
        amplifier: bigint;
        balances: bigint[];
        withdrawLp: bigint;
        totalSupply: bigint;
        fee: bigint;
    },
    idx: number,
): readonly [bigint, bigint] {
    if (idx >= balances.length || idx < 0) {
        throw new Error('idx is out of bounds');
    }
    const n = BigInt(balances.length);
    const _fee = (fee * n) / 4n / (n - 1n);
    const d0 = d ?? getD({ amplifier, balances });
    const d1 = getDAfterWithdraw({ d: d0, withdrawLp, totalSupply });

    const newX = getYD({ d: d1, amplifier, balances, idx });
    const dx0 = balances[idx] - newX;
    const balancesReduced = [...balances];

    for (let i = 0; i < balances.length; i++) {
        let dxExpected = 0n;
        if (i === idx) {
            dxExpected = (balances[i] * d1) / d0 - newX;
        } else {
            dxExpected = balances[i] - (balances[i] * d1) / d0;
        }
        balancesReduced[i] -= (_fee * dxExpected) / WEI_VALUE;
    }
    let dx =
        balancesReduced[idx] -
        getYD({ d: d1, amplifier, balances: balancesReduced, idx });
    dx -= 1n;

    return [dx, dx0 - dx] as const;
}

/**
 * Get max Y withdraw amount
 */
export function getMaxY(
    {
        d,
        amplifier,
        balances,
        withdrawLp,
        totalLp,
        newBalances,
    }: {
        d?: bigint;
        amplifier: bigint;
        balances: bigint[];
        withdrawLp: bigint;
        totalLp: bigint;
        newBalances: bigint[];
    },
    index: number,
): readonly [bigint, bigint] {
    if (
        index >= balances.length ||
        newBalances.length !== balances.length ||
        index < 0
    ) {
        return [0n, 0n] as const;
    }
    const n = BigInt(balances.length);
    const nPowN = n ** n;
    const d0 = d ?? getD({ amplifier, balances });
    const d1 = getDAfterWithdraw({ d: d0, withdrawLp, totalSupply: totalLp });
    const sum0 = balances.reduce((acc, balance) => acc + balance, 0n);
    const sum1 = newBalances.reduce((acc, balance) => acc + balance, 0n);
    const prod = newBalances.reduce(
        (acc, cur) => (cur > 0n ? acc * cur : acc),
        1n,
    );

    let y = (sum0 * (totalLp - withdrawLp)) / totalLp - sum1;
    let lastY = 0n;

    for (let i = 0; i < 255; i++) {
        const fx =
            amplifier * nPowN * (sum1 + y) +
            d1 -
            amplifier * d1 * nPowN -
            d1 ** (n + 1n) / nPowN / y / prod;
        const fpx = amplifier * nPowN + d1 ** (n + 1n) / nPowN / y / y / prod;
        lastY = y;
        y -= fx / fpx;

        if (y > lastY && y - lastY <= PRECISION) {
            break;
        }

        if (y < lastY && lastY - y <= PRECISION) {
            break;
        }
    }

    return [y, balances[index] - y] as const;
}
