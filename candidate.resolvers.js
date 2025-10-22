import { ValidateToken } from "./services/Auth"
import { GenerateBillingReference } from "./services/Billing"
import { ValidateIbanBicCandidateInput, CompareIbanBicExistingCandidateWithCandidateInput } from "./services/Iban"

async function UpdateCandidate(
    parent,
    {
        _id,
        candidate_input,
        lang,
        new_desired_program,
        is_from_admission_form,
        is_prevent_resend_notif,
        is_save_identity_student,
        is_minor_student,
    },
    context
) {
    let userId = ValidateToken(context);
    if (!userId) {
        throw new ApolloError('Unauthorized Access');
    }

    candidate_input = ModifyCandidateInputData(candidate_input);

      // *************** find candidate first before update
    const candidateBeforeUpdate = await CandidateModel.findById(_id).select('iban payment_supports parents').lean();

    await ValidateIbanBicCandidateInput(_id, candidate_input);

    if (candidateBeforeUpdate){
        CompareIbanBicExistingCandidateWithCandidateInput(_id, candidate_input, candidateBeforeUpdate);
    }

    const nowTime = moment.utc();
    const oldCandidate = await CandidateModel.findById(_id);

    candidate_input = SetLegalRepresentatvie(candidate_input, oldCandidate);
    candidate_input = SetCandidateFinances(candidate_input, oldCandidate);

    let oldSelectedPaymentPlanData = JSON.parse(JSON.stringify(oldCandidate.selected_payment_plan));
    oldSelectedPaymentPlanData.payment_date = oldSelectedPaymentPlanData.payment_date.map((term) => {
        delete term._id;
        return term;
    });
    
    candidate_input = await SetEmailCandidate(candidate_input, oldCandidate, lang);

    CheckSelecetdPaymentPlan(oldSelectedPaymentPlanData, candidate_input, is_from_admission_form);

    if (!userId) userId = oldCandidate.user_id; //in case this mutation called without auth token

    if (!oldCandidate.admission_process_id) {
        if (is_from_admission_form || (candidate_input.payment_method && candidate_input.payment_method !== oldCandidate.payment_method)) {
        await CandidateUtility.validateCandidateInput(candidate_input, oldCandidate);

        if (
            ['registered', 'engaged', 'resigned_after_engaged', 'resigned_after_registered'].includes(oldCandidate.candidate_admission_status)
        ) {
            const current_step = await CandidateUtility.getCandidateCurrentStep(oldCandidate);
            if (!candidate_input.payment_method && current_step !== 'down_payment') {
            throw new ApolloError('Cannot edit data, candidate already signed school contract!');
            }
        }
        }
    }

    await UpdateCandidateStatus(candidate_input, oldCandidate);
    await UpdateCandidateStepStatus(candidate_input, oldCandidate);
    await AcceptCampusValidation(oldCandidate);
    await AcceptSchoolContractStep(candidate_input, oldCandidate, is_save_identity_student);

    if (candidate_input?.parents.length) {
    const validParentsData = [];
    for (let i = 0; i < candidate_input.parents.length; i++) {
      // ******** separate valid and unvalid data
      if (candidate_input.parents[i].family_name && candidate_input.parents[i].name && candidate_input.parents[i].email) {
        validParentsData.push(candidate_input.parents[i]);
      }
    }
    candidate_input.parents = validParentsData;
  }

  // *************** failsafe, empty payment support if required data is null
  if (candidate_input?.payment_supports?.length) {
    const validatedPaymentSupportsData = [];
    for (let i = 0; i < candidate_input.payment_supports.length; i++) {
      // ******** separate valid and unvalid data
      if (
        candidate_input.payment_supports[i].family_name &&
        candidate_input.payment_supports[i].name &&
        candidate_input.payment_supports[i].email
      ) {
        validatedPaymentSupportsData.push(candidate_input.payment_supports[i]);
      }
    }
    candidate_input.payment_supports = validatedPaymentSupportsData;
  }

  // ******************* Save history legal representative
  await CandidateUtility.SaveHistoryLegalRepresentative(candidate_input, _id, userId);

  await GenerateBillingReference(candidate_input, new_desired_program, is_prevent_resend_notif, is_minor_student);


}

function ModifyCandidateInputData(candidate_input) {
    // Uppercase school and campus
    if (candidate_input.school) {
        candidate_input.school = String(candidate_input.school).toUpperCase();
    }
    if (candidate_input.campus) {
        candidate_input.campus = String(candidate_input.campus).toUpperCase();
    }

    // Set Gender
    if (candidate_input.civility) {
        if (candidate_input.civility === 'neutral') {
            candidate_input.sex = 'N';
        } else {
            candidate_input.sex = candidate_input.civility === 'MR' ? 'M' : 'F';
        }
    }

     if (candidate_input.tag_ids === null) {
        candidate_input.tag_ids = [];
    }
}

function SetLegalRepresentatvie(candidate_input, oldCandidate) {
    // ******************* check if unique_id is exist in legal representative, if exist, then use old representative, otherwise create new using UUID
    if (candidate_input.legal_representative && !candidate_input.legal_representative.unique_id) {
        candidate_input.legal_representative.unique_id =
        oldCandidate?.legal_representative?.unique_id
            ? oldCandidate.legal_representative.unique_id
            : common.create_UUID();
    }

    // ******************* check candidate if have civility not exist, then use parental link to add civility
    if (
        candidate_input.legal_representative &&
        !candidate_input.legal_representative.civility &&
        candidate_input.legal_representative.parental_link
    ) {
        const relations = ['father', 'grandfather', 'uncle'];
        const parentalLink =
        candidate_input?.legal_representative?.parental_link
            ? candidate_input.legal_representative.parental_link
            : '';
        candidate_input.legal_representative.civility = parentalLink === 'other' ? '' : relations.includes(parentalLink) ? 'MR' : 'MRS';
    }

    // ******************* make last name legal representative to uppercase
    if (candidate_input?.legal_representative?.last_name) {
        candidate_input.legal_representative.last_name = candidate_input.legal_representative.last_name.toUpperCase();
    }

    return candidate_input;
}

function SetCandidateFinances(candidate_input, oldCandidate) {
    if (
    !candidate_input.finance &&
    !oldCandidate.finance &&
    oldCandidate.selected_payment_plan &&
    oldCandidate.selected_payment_plan.payment_mode_id
  ) {
    if (
      (candidate_input.payment_supports && candidate_input.payment_supports.length) ||
      (oldCandidate.payment_supports && oldCandidate.payment_supports.length)
    ) {
      candidate_input.finance = 'family';
    } else {
      candidate_input.finance = 'my_self';
    }
  }

  return candidate_input;
}

async function SetEmailCandidate(candidate_input, oldCandidate, lang) {
    // ************** add condition if candidate old email is different from input and candidate is registered
    if (
        oldCandidate?.user_id &&
        oldCandidate?.candidate_admission_status === 'registered' &&
        candidate_input &&
        ((oldCandidate.email && candidate_input.email && oldCandidate.email !== candidate_input.email) ||
        (!oldCandidate.email && candidate_input.email))
    ) {
        // ************** if different, then remove the recovery code in user
        await UserModel.updateOne(
        { _id: oldCandidate.user_id },
        {
            $set: {
            email: candidate_input.email,
            recovery_code: '',
            },
        },
        { new: true }
        );
        // ************** update candidate email so the notificatio can get user id based on new email instead of old email
        await CandidateModel.updateOne({ _id: oldCandidate._id }, { $set: { email: candidate_input.email } });

        // ************** send notif stud reg n1 for set the recovery code again
        await CandidateUtility.Send_STUD_REG_N1(oldCandidate._id, lang);
    }
}

function CheckSelecetdPaymentPlan(oldSelectedPaymentPlanData, candidate_input, is_from_admission_form) {
    if (
    candidate_input &&
    oldSelectedPaymentPlanData?.total_amount &&
    oldSelectedPaymentPlanData.total_amount > 0 &&
    candidate_input.selected_payment_plan &&
    typeof oldSelectedPaymentPlanData === 'object' &&
    typeof candidate_input.selected_payment_plan === 'object'
  ) {
    for (const [key, value] of Object.entries(candidate_input.selected_payment_plan)) {
      if (String(candidate_input.selected_payment_plan[key]) !== String(oldSelectedPaymentPlanData[key])) {
        throw new ApolloError('payment plan is already selected!');
      }
    }
  }
}

async function UpdateCandidateStatus(candidate_input, oldCandidate) {
    if (
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'registered' &&
      candidate_input.candidate_admission_status === 'resigned') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'registered' &&
      candidate_input.candidate_admission_status === 'resigned_after_engaged') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'registered' &&
      candidate_input.candidate_admission_status === 'resigned_after_registered') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'registered' &&
      candidate_input.candidate_admission_status === 'no_show') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'registered' &&
      candidate_input.candidate_admission_status === 'resignation_missing_prerequisites') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'registered' &&
      candidate_input.candidate_admission_status === 'resign_after_school_begins') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'registered' &&
      candidate_input.candidate_admission_status === 'report_inscription')
  ) {
    const candidateFound = await CandidateModel.findById(oldCandidate._id).select('student_id').lean();
    const otherCandidateSameStudent = await CandidateModel.find({ student_id: candidateFound.student_id }).select('_id').lean();

    let candidateIds = [];
    if (otherCandidateSameStudent.length === 0) {
      candidateIds.push(oldCandidate._id);
    } else {
      otherCandidateSameStudent.map((candidateId) => candidateIds.push(candidateId._id));
    }

    await CandidateModel.updateMany(
      { _id: { $in: candidateIds }, readmission_status: 'assignment_table' },
      {
        $set: {
          is_student_resigned: true,
        },
      }
    );
  }

  if (
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'resigned' &&
      candidate_input.candidate_admission_status === 'registered') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'resigned_after_engaged' &&
      candidate_input.candidate_admission_status === 'registered') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'resigned_after_registered' &&
      candidate_input.candidate_admission_status === 'registered') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'no_show' &&
      candidate_input.candidate_admission_status === 'registered') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'resignation_missing_prerequisites' &&
      candidate_input.candidate_admission_status === 'registered') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'resign_after_school_begins' &&
      candidate_input.candidate_admission_status === 'registered') ||
    (candidate_input.candidate_admission_status &&
      oldCandidate.candidate_admission_status === 'report_inscription' &&
      candidate_input.candidate_admission_status === 'registered')
  ) {
    const candidateFound = await CandidateModel.findById(oldCandidate._id).select('student_id').lean();
    const otherCandidateSameStudent = await CandidateModel.find({ student_id: candidateFound.student_id }).select('_id').lean();

    let candidateIds = [];
    if (otherCandidateSameStudent.length === 0) {
      candidateIds.push(oldCandidate._id);
    } else {
      otherCandidateSameStudent.map((candidateId) => candidateIds.push(candidateId._id));
    }

    await CandidateModel.updateMany(
      { _id: { $in: candidateIds }, readmission_status: 'assignment_table' },
      {
        $set: {
          is_student_resigned: false,
        },
      }
    );
  }
}

async function UpdateCandidateStepStatus(candidate_input, oldCandidate) {
    const typeOfFormation = await TypeOfFormationModel.findById(oldCandidate.type_of_formation_id);
    const continuousTypeOfFormation = [
        'continuous',
        'continuous_total_funding',
        'continuous_partial_funding',
        'continuous_personal_funding',
        'continuous_contract_pro',
    ];
    let admissionProcess = null;

    if (oldCandidate.admission_process_id) {
        // admissionProcess = await StudentAdmissionProcessModel.findById(oldCandidate.admission_process_id)
        admissionProcess = await FormProcessModel.findById(oldCandidate.admission_process_id)
        .populate([
            {
            path: 'steps form_builder_id',
            populate: {
                path: 'steps',
            },
            },
            {
            path: 'candidate_id',
            populate: {
                path: 'continuous_formation_manager_id',
            },
            },
        ])
        .exec();
        // handle input payment_method cash to update step down payment mode
        if (candidate_input.payment_method === 'cash') {
        if (admissionProcess && admissionProcess.steps && admissionProcess.steps.length) {
            const downPaymentStep = admissionProcess.steps.find((step) => step.step_type === 'down_payment_mode');
            if (downPaymentStep) {
            // await StudentAdmissionProcessStepModel.findByIdAndUpdate(downPaymentStep._id, { $set: { step_status: 'accept' } });
            await FormProcessStepModel.findByIdAndUpdate(downPaymentStep._id, { $set: { step_status: 'accept' } });
            await CandidateUtility.updateCandidateAdmissionStatusFromAdmissionProcessStep(_id, downPaymentStep._id, context.userId, lang);
            await StudentAdmissionProcessUtilities.validateStatusStepFinalMessage(admissionProcess._id);
            }
        }
        }
    }
}

async function AcceptCampusValidation(oldCandidate) {
    if (
    typeOfFormation &&
    (continuousTypeOfFormation.includes(typeOfFormation.type_of_formation) || oldCandidate.readmission_status === 'readmission_table') &&
    candidate_input.program_confirmed &&
    candidate_input.program_confirmed === 'done'
  ) {
    if (admissionProcess?.admissionProcess?.steps?.length) {
      const campusStep = admissionProcess.steps.find((step) => step.step_type === 'campus_validation');
      if (campusStep) {
        await FormProcessStepModel.findByIdAndUpdate(campusStep._id, { $set: { step_status: 'accept' } });
        await CandidateUtility.updateCandidateAdmissionStatusFromAdmissionProcessStep(_id, campusStep._id, context.userId, lang);
      }
    }
  }
}

async function AcceptSchoolContractStep(candidate_input, oldCandidate, is_save_identity_student) {
    if (
    typeOfFormation &&
    (continuousTypeOfFormation.includes(typeOfFormation.type_of_formation) || oldCandidate.readmission_status === 'readmission_table') &&
    candidate_input.signature &&
    candidate_input.signature === 'done'
  ) {
    if (admissionProcess?.steps?.length) {
      const summaryStep = admissionProcess.steps.find((step) => step.step_type === 'summary');
      if (summaryStep) {
        // await StudentAdmissionProcessStepModel.findByIdAndUpdate(summaryStep._id, { $set: { step_status: 'accept' } }, { new: true });
        await FormProcessStepModel.findByIdAndUpdate(summaryStep._id, { $set: { step_status: 'accept' } }, { new: true });
        await CandidateUtility.updateCandidateAdmissionStatusFromAdmissionProcessStep(_id, summaryStep._id, context.userId, lang);
        await FormProcessModel.findByIdAndUpdate(oldCandidate.admission_process_id, {
          $set: {
            signature_date: {
              date: nowTime.format('DD/MM/YYYY'),
              time: nowTime.format('HH:mm'),
            },
          },
        });

        candidate_input.candidate_sign_date = {
          date: nowTime.format('DD/MM/YYYY'),
          time: nowTime.format('HH:mm'),
        };
        // Update Candidate summaryStep
        const summarySchoolPdf = await StudentAdmissionProcessUtility.generatePDFStep(_id, summaryStep._id, lang);
        candidate_input.school_contract_pdf_link = summarySchoolPdf;
      }
    }
  }

  if (
    candidate_input.payment_method &&
    ['check', 'transfer'].includes(candidate_input.payment_method) &&
    oldCandidate.payment &&
    oldCandidate.payment === 'not_authorized'
  ) {
    candidate_input.payment = 'not_done';
  }

  if (oldCandidate.payment === 'done' && candidate_input.payment === 'pending') {
    candidate_input.payment = oldCandidate.payment;
  }

  if (candidate_input.payment_method && oldCandidate.payment_method === candidate_input.payment_method) {
    candidate_input.payment = oldCandidate.payment;
  }
  if (candidate_input.finance && oldCandidate.finance !== candidate_input.finance && candidate_input.finance === 'my_self') {
    // *************** is_save_identity_student are used in student card to not use iban validation when updating data in student card
    if (oldCandidate.method_of_payment === 'sepa' && !is_save_identity_student) {
      if (!candidate_input.iban || !candidate_input.bic || !candidate_input.account_holder_name) {
        throw new ApolloError('Answer of question is required');
      }
      const checkIban = await IbanHistoryModel.findOne({ candidate_id: oldCandidate._id }).sort({ _id: -1 }).lean();
      if (!checkIban || checkIban.message !== 'success') {
        throw new ApolloError('IBAN not verified');
      }
    }
  }
}
