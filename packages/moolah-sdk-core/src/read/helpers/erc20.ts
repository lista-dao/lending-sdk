import type { Address, PublicClient } from 'viem';
import { ERC20_ABI } from '../../contracts/abis';
import type { TokenInfo } from '../../types/common';

/**
 * Get ERC20 token information
 */
export async function getERC20Info(
    publicClient: PublicClient,
    address: Address,
): Promise<TokenInfo & { name: string }> {
    const [decimals, symbol, name] = await Promise.all([
        publicClient.readContract({
            address,
            abi: ERC20_ABI,
            functionName: 'decimals',
        }) as Promise<number>,
        publicClient.readContract({
            address,
            abi: ERC20_ABI,
            functionName: 'symbol',
        }) as Promise<string>,
        publicClient.readContract({
            address,
            abi: ERC20_ABI,
            functionName: 'name',
        }) as Promise<string>,
    ]);

    return {
        decimals,
        symbol,
        name,
        address,
    };
}

/**
 * Get ERC20 token balance
 */
export async function getERC20Balance(
    publicClient: PublicClient,
    tokenAddress: Address,
    userAddress: Address,
): Promise<bigint> {
    return publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
    }) as Promise<bigint>;
}
