pragma circom 2.2.3;
include "circomlib/circuits/poseidon.circom";

template LotOriginV1() {
    signal input originCode;
    signal input supplierIdHash;
    signal input salt;
    signal input privateLotCodeHash;
    signal input commitment;
    signal input publicAllowedCode;
    signal input lotCodeHash;

    originCode === publicAllowedCode;
    privateLotCodeHash === lotCodeHash;

    component credential = Poseidon(5);
    credential.inputs[0] <== 2;
    credential.inputs[1] <== originCode;
    credential.inputs[2] <== supplierIdHash;
    credential.inputs[3] <== salt;
    credential.inputs[4] <== privateLotCodeHash;
    credential.out === commitment;
}

component main {public [commitment, publicAllowedCode, lotCodeHash]} = LotOriginV1();
