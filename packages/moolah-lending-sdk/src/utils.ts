import type { Abi, Address } from 'viem';
import { encodeFunctionData } from 'viem';
import type { ChainId, ContractCallParams } from './types';

export function buildCallParams(params: {
    to: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    chainId: ChainId;
}): ContractCallParams {
    const data = encodeFunctionData({
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
    });

    return {
        to: params.to,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
        value: params.value,
        chainId: params.chainId,
        data,
    };
}
