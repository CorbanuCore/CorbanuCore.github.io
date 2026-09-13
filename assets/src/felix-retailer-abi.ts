// Verified RetailerUpgradeable ABI, Sourcify Ethereum implementation 0x11B49609EAaC8C9248F3128a6B76B89729bC0b7D.
export const FELIX_RETAILER_ABI = [
  {
    "name": "getBrokerageFee",
    "type": "function",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "name": "mintWithAttestation",
    "type": "function",
    "inputs": [
      {
        "name": "_quote",
        "type": "tuple",
        "components": [
          {
            "name": "chainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "attestationId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "userId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "asset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiration",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "side",
            "type": "uint8",
            "internalType": "enum IGMTokenManager.QuoteSide"
          },
          {
            "name": "additionalData",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "internalType": "struct IGMTokenManager.Quote"
      },
      {
        "name": "_signature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_depositToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_depositTokenAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const;
