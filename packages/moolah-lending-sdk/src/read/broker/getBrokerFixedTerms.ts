import type { Address, PublicClient } from 'viem';
import {
    Decimal,
    LENDING_BROKER_ABI,
    type FixedTermAndRate,
} from '@lista-dao/moolah-sdk-core';

const SECONDS_PER_DAY = 86400n;

/**
 * Get broker fixed terms
 */
export async function getBrokerFixedTerms(
    publicClient: PublicClient,
    brokerAddress: Address,
): Promise<FixedTermAndRate[]> {
    const terms = await publicClient.readContract({
        address: brokerAddress,
        abi: LENDING_BROKER_ABI,
        functionName: 'getFixedTerms',
        args: [],
    }) as readonly { termId: bigint; duration: bigint; apr: bigint }[];

    return terms.map(term => ({
        termId: term.termId,
        duration: Number(term.duration / SECONDS_PER_DAY),
        apr: (() => {
            const value = new Decimal(term.apr, 27);
            return value.gt(Decimal.ONE) ? value.sub(Decimal.ONE) : value;
        })(),
    }));
}
