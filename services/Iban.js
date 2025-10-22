export async function ValidateIbanBic(_id, iban, bic, account_holder_name, financial_support_first_name = "", financial_support_last_name = "") {
    const ibanHistory = await IbanHistoryModel.create({
      candidate_id: _id,
      iban: iban,
      bic: bic,
      account_holder_name: account_holder_name,
      financial_support_first_name: financial_support_first_name,
      financial_support_last_name: financial_support_last_name,
    });

    try {
      // *************** check iban input is valid
      await CandidateUtility.validateIbanBicCandidate(iban, bic);

      // *************** udpate the iban history with massage is success
      await IbanHistoryModel.updateOne({ _id: ibanHistory._id }, { $set: { message: 'success' } });
    } catch (error) {
      // *************** udpate the iban history with massage is error
      await IbanHistoryModel.updateOne({ _id: ibanHistory._id }, { $set: { message: error } });

      throw new ApolloError(error);
    }
}

export async function ValidateIbanBicCandidate(_id, iban, bic, account_holder_name) {
    await ValidateIbanBic(
      _id,
      iban,
      bic,
      account_holder_name
    );
}

export async function ValidateIbanBicCandidateInput(_id, candidate_input) {
     if (candidate_input?.parents?.length) {
        await ValidateIbanBicParents(_id, candidate_input.parents);
    }

    if (candidate_input.iban && candidate_input.bic && candidate_input.account_holder_name) {
        await ValidateIbanBicCandidate(_id, candidate_input.iban, candidate_input.bic, candidate_input.account_holder_name);
    }

    if (candidate_input?.payment_supports?.length) {
        await ValidateIbanBicPaymentSupports(_id, candidate_input.payment_supports);
    }
}

export async function ValidateIbanBicParents(_id, parents) {
    for (let parent of parents) {
      if (parent.iban && parent.bic && parent.account_holder_name) {
        await ValidateIbanBic(
          _id,
          parent.iban,
          parent.bic,
          parent.account_holder_name,
          parent.first_name || "",
          parent.family_name || ""
        );
      }
    }
}

export async function ValidateIbanBicPaymentSupports(_id, payment_supports) {
    for (let payment_support of payment_supports) {
      if (payment_support.iban && payment_support.bic && payment_support.account_holder_name) {
        await ValidateIbanBic(
          _id,
          payment_support.iban,
          payment_support.bic,
          payment_support.account_holder_name,
          payment_support.first_name || "",
          payment_support.family_name || ""
        );
      }
    }
}

export async function CompareIbanBicExistingCandidateWithCandidateInput(_id, candidate_input, candidateBeforeUpdate) {
    // *************** if iban in student is different from input
    if (
      (candidate_input.iban || (!candidate_input.iban && candidate_input.iban === '')) &&
      candidateBeforeUpdate.iban &&
      candidateBeforeUpdate.iban !== candidate_input.iban
    ) {
      // *************** create iban history update
      await IbanHistoryUpdateModel.create({
        candidate_id: _id,
        iban: candidate_input.iban,
        iban_before_update: candidateBeforeUpdate.iban,
        user_who_update_id: userId,
      });
    }

    // *************** if iban in payment supports is different from input, then set create history iban
    if (
      candidateBeforeUpdate?.payment_supports?.length &&
      candidate_input?.payment_supports?.length
    ) {
      for (const paymentSupportBeforeUpdate of candidateBeforeUpdate.payment_supports) {
        // *************** check iban in payment support is different from input
        let paymentSupportIbanData = candidate_input.payment_supports.find(
          (payment_support) =>
            String(paymentSupportBeforeUpdate._id) === String(payment_support._id) &&
            paymentSupportBeforeUpdate.iban &&
            payment_support.iban !== paymentSupportBeforeUpdate.iban
        );

        // *************** if iban is different
        if (paymentSupportIbanData) {
          // *************** create iban history update
          await IbanHistoryUpdateModel.create({
            candidate_id: _id,
            iban: paymentSupportIbanData.iban,
            iban_before_update: paymentSupportBeforeUpdate.iban,
            user_who_update_id: userId,
            financial_support_first_name: paymentSupportIbanData.name,
            financial_support_last_name: paymentSupportIbanData.family_name,
          });
        }
      }
    }

    // *************** if iban in payment supports is empty from input, create history iban deleted
    if (
      candidateBeforeUpdate?.parents?.length &&
      candidate_input?.parents?.length
    ) {
      // *************** loop per parents before update
      for (const parentBeforeUpdate of candidateBeforeUpdate.parents) {
        // *************** check if iban parents is different from input
        let parentIbanData = candidate_input.parents.find(
          (parent) =>
            String(parentBeforeUpdate._id) === String(parent._id) && parentBeforeUpdate.iban && parent.iban !== parentBeforeUpdate.iban
        );

        // *************** if parent data iban different
        if (parentIbanData) {
          // *************** create iban history update
          await IbanHistoryUpdateModel.create({
            candidate_id: _id,
            iban: parentIbanData.iban,
            iban_before_update: parentBeforeUpdate.iban,
            user_who_update_id: userId,
            financial_support_first_name: parentIbanData.name,
            financial_support_last_name: parentIbanData.family_name,
          });
        }
      }
    }
}
