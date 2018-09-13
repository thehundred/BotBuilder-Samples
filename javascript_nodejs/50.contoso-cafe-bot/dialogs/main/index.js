// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
const { ComponentDialog, DialogTurnStatus, DialogSet } = require('botbuilder-dialogs');
const { MessageFactory } = require('botbuilder');
const { WhoAreYouDialog, QnADialog, ChitChatDialog, HelpDialog, CancelDialog, WhatCanYouDoDialog, FindCafeLocationsDialog } = require('../index');
const { TurnResultHelper } = require('../shared/helpers');
const { GenSuggestedQueries } = require('../shared/helpers/genSuggestedQueries');
const { userProfileProperty } = require('../shared/stateProperties');

const MAIN_DIALOG = 'MainDialog';

// User name entity from ../whoAreYou/resources/whoAreYou.lu
const USER_NAME_ENTITY = 'userName_patternAny';
const NONE_INTENT = 'None';

// Query property from ../whatCanYouDo/resources/whatCanYHouDoCard.json
// When user responds to what can you do card, a query property is set in response.
const QUERY_PROPERTY = 'query';
const USER_PROFILE_PROPERTY = 'userProfileProperty';
const MAIN_DIALOG_STATE_PROPERTY = 'mainDialogState';

module.exports = {
    MainDialog: class extends ComponentDialog {
        /**
         * Constructor.
         * 
         * @param {Object} botConfig bot configuration
         * @param {Object} onTurnPropertyAccessor 
         * @param {Object} conversationState 
         * @param {Object} userState 
         */
        constructor(botConfig, onTurnPropertyAccessor, conversationState, userState) {
            super (MAIN_DIALOG);

            if (!botConfig) throw ('Missing parameter. Bot Configuration is required.');
            if (!onTurnPropertyAccessor) throw ('Missing parameter. On turn property accessor is required.');
            if (!conversationState) throw ('Missing parameter. Conversation state is required.');
            if (!userState) throw ('Missing parameter. User state is required.');

            // Create state objects for user, conversation and dialog states.   
            this.userProfilePropertyAccessor = userState.createProperty(USER_PROFILE_PROPERTY);
            this.mainDialogPropertyAccessor = conversationState.createProperty(MAIN_DIALOG_STATE_PROPERTY);

            // keep on turn accessor and bot configuration
            this.onTurnPropertyAccessor = onTurnPropertyAccessor;

            // add dialogs
            this.dialogs = new DialogSet(this.mainDialogPropertyAccessor);
            this.addDialog(new WhatCanYouDoDialog());
            this.addDialog(new CancelDialog());
            this.addDialog(new FindCafeLocationsDialog());
            this.addDialog(new QnADialog(botConfig, this.userProfilePropertyAccessor));
            this.addDialog(new WhoAreYouDialog(botConfig, this.userProfilePropertyAccessor, conversationState));
        }
        /**
         * Override onDialogBegin 
         * 
         * @param {Object} dc dialog context
         * @param {Object} options dialog turn options
         */
        async onDialogBegin(dc, options) {
            // Override default begin() logic with bot orchestration logic
            return await this.mainDispatch(dc);
        }
        /**
         * Override onDialogContinue
         * 
         * @param {Object} dc dialog context
         */
        async onDialogContinue(dc) {
            // Override default continue() logic with bot orchestration logic
            return await this.mainDispatch(dc);
        }
        /**
         * Main Dispatch 
         * 
         * This method examines the incoming turn property to determine  
         * 1. If the requested operation is permissible - e.g. if user is in middle of a dialog, 
         *     then an out of order reply should not be allowed.
         * 2. Calls any oustanding dialogs to continue
         * 3. If results is no-match from outstanding dialog .OR. if there are no outstanding dialogs,
         *    decide which child dialog should begin and start it
         * 
         * @param {Object} dc dialog context
         */
        async mainDispatch(dc) {
            // get on turn property through the property accessor
            const onTurnProperty = await this.onTurnPropertyAccessor.get(dc.context);
            
            // Evaluate if the requested operation is possible/ allowed.
            const reqOpStatus = await this.isRequestedOperationPossible(dc, onTurnProperty.intent);
            if (!reqOpStatus.allowed) {
                await dc.context.sendActivity(reqOpStatus.reason);
                // Nothing to do here. End main dialog.
                return await dc.end(); 
            }
            
            let dialogTurnResult;

            // continue outstanding dialogs
            dialogTurnResult = await dc.continue();

            // This will only be empty if there is no active dialog in the stack.
            if (!dc.context.responded) {
                // No one has responded so start the right child dialog.
                dialogTurnResult = await this.beginChildDialog(dc, onTurnProperty);
            }

            if(dialogTurnResult === undefined) return await dc.end();

            // Examine result from dc.continue() or from the call to beginChildDialog().
            switch (dialogTurnResult.status) {
                case DialogTurnStatus.complete: {
                    if (dialogTurnResult.result) {
                        switch (dialogTurnResult.result.reason) {
                            case 'Interruption': {
                                // Interruption. Begin child dialog
                                dialogTurnResult = await this.beginChildDialog(dc, onTurnProperty, dialogTurnResult.result.payload);
                                break;
                            } 
                            case 'Abandon': {
                                // Re-hydrate old dialog
                                dialogTurnResult = await this.beginChildDialog(dc, dialogTurnResult.result.payload.onTurnProperty);
                                break;
                            }
                        }
                    } else {
                        // The active dialog finished successfully. Ask user if they need help with anything else.
                        await dc.context.sendActivity(MessageFactory.suggestedActions(GenSuggestedQueries(), `Is there anything else I can help you with?`));
                        break;
                    }
                }
                case DialogTurnStatus.waiting: {
                    // The active dialog is waiting for a response from the user, so do nothing
                    break;
                }
                case DialogTurnStatus.cancelled: {
                    // The active dialog's stack has been cancelled
                    await dc.context.sendActivity(MessageFactory.suggestedActions(GenSuggestedQueries(), `Is there anything else I can help you with?`));
                    // End active dialog
                    await dc.cancelAll();
                    break;
                }
            }
            dialogTurnResult = (dialogTurnResult === undefined) ? new TurnResultHelper(DialogTurnStatus.empty) : dialogTurnResult;
            return dialogTurnResult;
        }
        /**
         * Method to begin appropriate child dialog based on user input
         * 
         * @param {Object} dc 
         * @param {Object} onTurnProperty 
         * @param {Object} childDialogPayload 
         */
        async beginChildDialog(dc, onTurnProperty, childDialogPayload) {
            switch (onTurnProperty.intent) {
                // Help, ChitChat and QnA share the same QnA Maker model. So just call the QnA Dialog.
                case QnADialog.Name: 
                case ChitChatDialog.Name: 
                case HelpDialog.Name: {
                    return await dc.begin(QnADialog.Name);
                }
                case CancelDialog.Name: {
                    return await dc.begin(CancelDialog.Name, childDialogPayload);
                } case WhoAreYouDialog.Name: {
                    return await this.beginWhoAreYouDialog(dc, onTurnProperty);
                } case FindCafeLocationsDialog.Name: {
                    return await dc.begin(FindCafeLocationsDialog.Name);
                } case WhatCanYouDoDialog.Name: {
                    return await this.beginWhatCanYouDoDialog(dc, onTurnProperty);
                } case NONE_INTENT: {
                    await dc.context.sendActivity(`I'm still learning.. Sorry, I do not know how to help you with that.`);
                    return await dc.context.sendActivity(`Follow [this link](https://www.bing.com/search?q=${dc.context.activity.text}) to search the web!`);
                }
            }
        }
        /**
         * Method to evaluate if the requested user operation is possible.
         * User could be in the middle of a multi-turn dialog where intteruption might not be possible or allowed.
         * 
         * @param {Object} dc 
         * @param {String} requestedOperation 
         * @returns {Object} outcome object
         */
        async isRequestedOperationPossible(dc, requestedOperation) {
            let activeDialog;
            let outcome = {allowed: true, reason: ''};
            if (dc.activeDialog !== undefined) activeDialog = dc.activeDialog.id;

            // E.g. What_can_you_do is not possible when you are in the middle of Who_are_you dialog
            if (requestedOperation === WhatCanYouDoDialog.Name) {
                if(activeDialog === WhoAreYouDialog.Name) {
                    outcome.allowed = false;
                    outcome.reason = `Sorry! I'm unable to process that. You can say 'cancel' to cancel this conversation..`;
                }
            } else if (requestedOperation === CancelDialog.Name) {
                if (activeDialog === undefined) {
                    outcome.allowed = false;
                    outcome.reason = `Sure, but there is nothing to cancel..`;
                }
            }
            return outcome;
        }
        /**
         * Helper method to begin who are you dialog.
         *  
         * @param {Object} dc dialog context
         * @param {Object} onTurnProperty
         */
        async beginWhoAreYouDialog(dc, onTurnProperty) {
            // Get user profile.
            let userProfile = await this.userProfilePropertyAccessor.get(dc.context);
            // Handle case where user is re-introducing themselves. 
            // These utterances are defined in ../whoAreYou/resources/whoAreYou.lu 
            let userNameInOnTurnProperty = (onTurnProperty.entities || []).filter(item => item.entityName == USER_NAME_ENTITY);
            if (userNameInOnTurnProperty.length !== 0) {
                let userName = userNameInOnTurnProperty[0].entityValue[0];
                // capitalize user name   
                userName = userName.charAt(0).toUpperCase() + userName.slice(1);
                this.userProfilePropertyAccessor.set(dc.context, new userProfileProperty(userName));
                return await dc.context.sendActivity(`Hello ${userName}, Nice to meet you again! I'm the Contoso Cafe Bot.`);
            }
            // Begin the who are you dialog if we have an invalid or empty user name or if the user name was previously set to 'Human'
            if (userProfile === undefined || userProfile.userName === '' || userProfile.userName === 'Human') {
                await dc.context.sendActivity(`Hello, I'm the Contoso Cafe Bot.`);
                // Begin user Profile dialog to ask user their name
                return await dc.begin(WhoAreYouDialog.Name);
            } else {
                // Already have the user name. So just greet them.
                return await dc.context.sendActivity(`Hello ${userProfile.userName}, Nice to meet you again! I'm the Contoso Cafe Bot.`);
            }
        }
        /**
         * Helper method to begin what can you do dialog.
         * 
         * @param {Object} dc dialog context
         * @param {Object} onTurnProperty 
         */
        async beginWhatCanYouDoDialog(dc, onTurnProperty) {
            // Handle case when user interacted with the what can you do card.
            // What can you do card sends a custom data property with intent name, text value and possible entities.
            // See ../whatCanYouDo/resources/whatCanYouDoCard.json for card definition.
            let queryProperty = (onTurnProperty.entities || []).filter(item => item.entityName == QUERY_PROPERTY);
            if (queryProperty.length !== 0) {
                let parsedJSON;
                try {
                    parsedJSON = JSON.parse(queryProperty[0].entityValue);
                } catch (err) {
                    return await dc.context.sendActivity(`Try and choose a query from the card before you click the 'Let's talk!' button.`);
                }
                if (parsedJSON.text !== undefined) {
                    dc.context.activity.text = parsedJSON.text;
                    await dc.context.sendActivity(`You said: '${dc.context.activity.text}'`);
                }
                return await this.beginChildDialog(dc, parsedJSON);
            }
            return await dc.begin(WhatCanYouDoDialog.Name);
        }
    }
};