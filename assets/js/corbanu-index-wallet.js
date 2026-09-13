(function () {
  "use strict";
  let provider = null, account = null;
  const announced = [];
  const validAccount = value => typeof value === "string" && value.length === 42 && value.startsWith("0x") && [...value.slice(2)].every(c => "0123456789abcdefABCDEF".includes(c));
  function changed(accounts) {
    const previous=account;account = validAccount(accounts?.[0]) ? accounts[0] : null;
    if(previous?.toLowerCase()!==account?.toLowerCase())window.dispatchEvent(new Event("corbanu:wallet-changed"));
  }
  window.addEventListener("eip6963:announceProvider", event => {
    const detail = event.detail;
    if (detail?.info?.rdns === "io.metamask" && typeof detail.provider?.request === "function" && !announced.includes(detail.provider)) announced.push(detail.provider);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.CorbanuWallet = {
    get account() { return account; },
    async connect() {
      if (!provider) {
        window.dispatchEvent(new Event("eip6963:requestProvider"));
        provider = announced[0] || window.ethereum?.providers?.find(p => p.isMetaMask) || (window.ethereum?.isMetaMask ? window.ethereum : null);
        if (!provider) throw new Error("Open this page in the MetaMask browser or install the MetaMask extension, then try again.");
        provider.on?.("accountsChanged", changed);
        provider.on?.("disconnect", () => changed([]));
      }
      changed(await provider.request({method:"eth_requestAccounts"}));
      if (!account) throw new Error("No MetaMask account was selected.");
      return account;
    },
    async request(args, expectedAccount) {
      if (!provider || !account) throw new Error("Connect MetaMask first.");
      const accounts=await provider.request({method:"eth_accounts"});changed(accounts);
      if(!account || account.toLowerCase()!==expectedAccount.toLowerCase())throw new Error("Your wallet account changed.");
      return provider.request(args);
    },
    async signMessage(message, expectedAccount) {
      if (!provider || !account) throw new Error("Connect MetaMask first.");
      changed(await provider.request({method:"eth_accounts"}));
      if (!account || account.toLowerCase() !== expectedAccount.toLowerCase()) throw new Error("Your wallet account changed. Request a new ownership challenge.");
      const hex = "0x" + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, "0")).join("");
      return provider.request({method:"personal_sign",params:[hex,account]});
    }
  };
})();
