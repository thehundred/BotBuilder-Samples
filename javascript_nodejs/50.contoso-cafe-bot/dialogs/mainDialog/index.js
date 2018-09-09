// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ComponentDialog, DialogTurnStatus, WaterfallDialog, DialogSet } = require('botbuilder-dialogs');
const MAIN_DIALOG = 'MainDialog';
const DialogTurnResult = require('../shared/turnResult');
const propertyAccessors = require('./mainDialogPropAccessors');
const BookTableDialog = require('../bookTable');
const WhoAreYouDialog = require('../whoAreYou');
const QnADialog = require('../qna');
const ChitChatDialog = require('../chitChat');
const HelpDialog = require('../help');
const CancelDialog = require('../cancel');
const FindCafeLocationsDialog = require('../findCafeLocations');
class MainDialog extends ComponentDialog {

    constructor(botConfig, onTurnPropertyAccessor, conversationState, userState) {
        super(MAIN_DIALOG)
        if(!botConfig) throw ('Need bot config');
        if(!onTurnPropertyAccessor) throw ('Need on turn property accessor');

        // Create state objects for user, conversation and dialog states.   
        this.propertyAccessors = new propertyAccessors(conversationState, userState);
        // keep on turn accessor and bot configuration
        this.onTurnPropertyAccessor = onTurnPropertyAccessor;
        this.botConfig = botConfig;
        // add dialogs
        this.dialogs = new DialogSet(this.propertyAccessors.mainDialogPropertyAccessor);
        // add book table dialog
        // add who are you dialog
        // add cancel dialog
        //this.dialogs.add(new MainDialog(botConfig, this.botState.onTurnPropertyAccessor, conversationState, userState));
        this.dialogs.add(new CancelDialog(this.propertyAccessors.activeDialogPropertyAccessor, onTurnPropertyAccessor, conversationState));
        // other single-turn dialogs
        this.qnaDialog = new QnADialog(botConfig);
    }

    async onDialogBegin(dc, options) {
        // Override default begin() logic with bot orchestration logic
        return await this.onDialogContinue(dc);
    }

    async onDialogContinue(dc) {
        let dialogTurnResult = new DialogTurnResult(DialogTurnStatus.empty);
        // get on turn property through the property accessor
        const onTurnProperty = await this.onTurnPropertyAccessor.get(dc.context);

        // Main Dialog examines the incoming turn property to determine  
        //     1. If the requested operation is permissible - e.g. if user is in middle of a dialog, then an out of order reply should not be allowed.
        //     2. Calls any oustanding dialogs to continue
        //     3. If results is no-match from outstanding dialog .OR. if there are no outstanding dialogs,
        //         Decide which child dialog should begin and start it
        //         
        const reqOpStatus = await this.isRequestedOperationPossible(dc, onTurnProperty.intent);

        if(!reqOpStatus.allowed) {
            await dc.context.sendActivity(reqOpStatus.reason);
            return dialogTurnResult; 
        }

        dialogTurnResult = await dc.continue();

        if(dialogTurnResult.status !== DialogTurnStatus.empty) return dialogTurnResult;

        switch(dialogTurnResult.status) {
            case DialogTurnStatus.empty: {
                // begin right child dialog
                dialogTurnResult = await this.beginChildDialog(dc, onTurnProperty);
                break;
            }
            case DialogTurnStatus.complete: {
                // The active dialog's stack ended with a complete status
                await dc.context.sendActivity(`What else can I help you with?`);
                // End active dialog
                await dc.EndAsync();
                break;
            }
            case DialogTurnStatus.waiting: {
                // The active dialog is waiting for a response from the user, so do nothing
                break;
            }
            case DialogTurnStatus.cancelled: {
                // The active dialog's stack has been cancelled
                await dc.context.sendActivity(`What else can I help you with?`);
                // End active dialog
                await dc.cancelAll();
                break;
            }
        }
        dialogTurnResult = (dialogTurnResult === undefined) ? new DialogTurnResult(DialogTurnStatus.empty) : dialogTurnResult;
        return dialogTurnResult;
    }

    async beginChildDialog(dc, onTurnProperty) {
        switch(onTurnProperty.intent) {
            // Help, ChitChat and QnA share the same QnA Maker model. So just call the QnA Dialog.
            case QnADialog.Name: 
            case ChitChatDialog.Name: 
            case HelpDialog.Name: {
                return await this.qnaDialog.onTurn(dc.context);
            }
            case CancelDialog.Name: {
                return await dc.context.sendActivity(`Cancel`);
                //return await dc.begin(CancelDialog.Name);
                break;
            } case BookTableDialog.Name: {
                return await dc.context.sendActivity(`Book Table`);
                break;
            } case WhoAreYouDialog.Name: {
                return await dc.context.sendActivity(`Who are You!`);
                break;
            } case FindCafeLocationsDialog.Name: {
                return await dc.context.sendActivity(`Find Cafe Locations!`);
                break;
            }
        }

    }
    async isRequestedOperationPossible(dc, requestedOperation) {
        let outcome = {allowed: true, reason: ''};
        
        // get active dialog from property accessor
        // TODO: Evaluate if this can be achieved via dc.activeDialog instead of a separate property
        const activeDialog = await this.propertyAccessors.activeDialogPropertyAccessor.get(dc.context);

        // Book table submit and Book Table cancel requests through book table card are not allowed when Book Table is not the active dialog
        if(requestedOperation === 'Book_Table_Submit' || requestedOperation === 'Book_Table_Cancel') {
            if(activeDialog !== BookTableDialog.Name) {
                outcome.allowed = false;
                outcome.reason = `Sorry! I'm unable to process that. To start a new table reservation, try 'Book a table'`;
            }
        } 
        else if(requestedOperation === CancelDialog.Name) {
            // Cancel dialog (with confirmation) is only possible for multi-turn dialogs - Book Table, Who are you
            if(activeDialog !== BookTableDialog.Name || activeDialog !== WhoAreYouDialog.Name) {
                outcome.allowed = false;
                outcome.reason = `Nothing to cancel.`;
            }
        }
        
        
        return outcome;
    }
};
MainDialog.Name = MAIN_DIALOG;

module.exports = MainDialog;