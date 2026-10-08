pragma circom 2.2.3;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template AgeEligibilityV1() {
    signal input dobDay;
    signal input salt;
    signal input holderSecret;
    signal input commitment;
    signal input cutoffDay;
    signal input requestHash;
    signal input nullifier;

    component dobRange = Num2Bits(17);
    component cutoffRange = Num2Bits(17);
    dobRange.in <== dobDay;
    cutoffRange.in <== cutoffDay;

    component eligible = LessEqThan(17);
    eligible.in[0] <== dobDay;
    eligible.in[1] <== cutoffDay;
    eligible.out === 1;

    component calendarMax = LessEqThan(17);
    calendarMax.in[0] <== cutoffDay;
    calendarMax.in[1] <== 73413;
    calendarMax.out === 1;

    component credential = Poseidon(4);
    credential.inputs[0] <== 1;
    credential.inputs[1] <== dobDay;
    credential.inputs[2] <== salt;
    credential.inputs[3] <== holderSecret;
    credential.out === commitment;

    component replayBinding = Poseidon(3);
    replayBinding.inputs[0] <== 3;
    replayBinding.inputs[1] <== holderSecret;
    replayBinding.inputs[2] <== requestHash;
    replayBinding.out === nullifier;
}

component main {public [commitment, cutoffDay, requestHash, nullifier]} = AgeEligibilityV1();
