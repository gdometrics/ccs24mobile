// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.addons.mod_assign')

/**
 * Handler for online text submission plugin.
 *
 * @module mm.addons.mod_assign
 * @ngdoc service
 * @name $mmaModAssignSubmissionOnlinetextHandler
 */
.factory('$mmaModAssignSubmissionOnlinetextHandler', function($mmSite, $mmaModAssign, $q, $mmaModAssignHelper, $mmWS, $mmText) {

    var self = {};

    /**
     * Function meant to copy a submission.
     * Should add to pluginData the data to send to server based in the data in plugin (previous attempt).
     *
     * @param  {Object} assign     Assignment.
     * @param  {Object} plugin     Plugin data of the previous submission (the one to get the data from).
     * @param  {Object} pluginData Object where to add the plugin data.
     * @return {Promise}           Promise resolved when copied.
     */
    self.copySubmissionData = function(assign, plugin, pluginData) {
        var text = $mmaModAssign.getSubmissionPluginText(plugin, true),
            files = $mmaModAssign.getSubmissionPluginAttachments(plugin),
            promise;

        if (!files.length) {
            // No files to copy, no item ID.
            promise = $q.when(0);
        } else {
            // Re-upload the files.
            promise = $mmaModAssignHelper.uploadFiles(assign.id, files);
        }

        return promise.then(function(itemId) {
            pluginData.onlinetext_editor = {
                text: text,
                format: 1,
                itemid: itemId
            };
        });
    };

    /**
     * Get files used by this plugin.
     * The files returned by this function will be prefetched when the user prefetches the assign.
     *
     * @param  {Object} assign     Assignment.
     * @param  {Object} submission Submission to check data.
     * @param  {Object} plugin     Plugin.
     * @param  {String} [siteId]   Site ID. If not defined, current site.
     * @return {Promise}           Promise resolved when prefetch is done.
     */
    self.getPluginFiles = function(assign, submission, plugin, siteId) {
        return $mmaModAssign.getSubmissionPluginAttachments(plugin);
    };

    /**
     * Get the size of data (in bytes) this plugin will send to copy a previous attempt.
     *
     * @param  {Object} assign Assignment.
     * @param  {Object} plugin Plugin data of the previous submission (the one to get the data from).
     * @return {Promise}       Promise resolved with the size.
     */
    self.getSizeForCopy = function(assign, plugin) {
        var text = $mmaModAssign.getSubmissionPluginText(plugin, true),
            files = $mmaModAssign.getSubmissionPluginAttachments(plugin),
            totalSize = text.length,
            promises;

        if (!files.length) {
            return totalSize;
        }

        promises = [];

        angular.forEach(files, function(file) {
            promises.push($mmWS.getRemoteFileSize(file.fileurl).then(function(size) {
                if (size == -1) {
                    // Couldn't determine the size, reject.
                    return $q.reject();
                }
                totalSize += size;
            }));
        });

        return $q.all(promises).then(function() {
            return totalSize;
        });
    };

    /**
     * Get the size of data (in bytes) this plugin will send to add or edit a submission.
     *
     * @param  {Object} assign     Assignment.
     * @param  {Object} submission Submission to check data.
     * @param  {Object} plugin     Plugin to get the data for.
     * @param  {Object} inputData  Data entered in the submission form.
     * @return {Number}            Size.
     */
    self.getSizeForEdit = function(assign, submission, plugin, inputData) {
        var text = $mmaModAssign.getSubmissionPluginText(plugin, true);
        return text.length;
    };

    /**
     * Whether or not the plugin is enabled for the site.
     *
     * @return {Boolean}
     */
    self.isEnabled = function() {
        return true;
    };

    /**
     * Whether or not the plugin is enabled for editing in the site.
     * This should return true if the plugin has no submission component (allow_submissions=false),
     * otherwise the user won't be able to edit submissions at all.
     *
     * @return {Boolean}
     */
    self.isEnabledForEdit = function() {
        // There's a bug in Moodle 3.1.0 that doesn't allow submitting HTML, so we'll disable this plugin in that case.
        // Bug was fixed in 3.1.1 minor release (2016052301) and in master version 2016070700.
        var version = parseInt($mmSite.getInfo().version, 10),
            localMobileEnabled = $mmSite.checkIfAppUsesLocalMobile();

        return (version >= 2016052301 && version < 2016052400) || version >= 2016070700 || localMobileEnabled;
    };

    /**
     * Get the name of the directive to render this plugin.
     *
     * @param  {Object} plugin Plugin to get the directive for.
     * @param  {Boolean} edit  True if editing a submission, false if read only.
     * @return {String} Directive name.
     */
    self.getDirectiveName = function(plugin, edit) {
        return 'mma-mod-assign-submission-onlinetext';
    };

    /**
     * Should prepare and add to pluginData the data to send to server based in the input data.
     *
     * @param  {Object} assign     Assignment.
     * @param  {Object} submission Submission to check data.
     * @param  {Object} plugin     Plugin to get the data for.
     * @param  {Object} inputData  Data entered in the submission form.
     * @param  {Object} pluginData Object where to add the plugin data.
     * @return {Void}
     */
    self.prepareSubmissionData = function(assign, submission, plugin, inputData, pluginData) {
        pluginData.onlinetext_editor = {
            text: getTextToSubmit(plugin, inputData),
            format: 1,
            itemid: 0 // Can't add new files yet, so we use a fake itemid.
        };
    };

    /**
     * Check if the submission data has changed for this plugin.
     *
     * @param  {Object} assign     Assignment.
     * @param  {Object} submission Submission to check data.
     * @param  {Object} plugin     Plugin.
     * @param  {Object} inputData  Data entered in the submission form.
     * @return {Promise}           Promise resolved with true if data has changed, resolved with false otherwise.
     */
    self.hasDataChanged = function(assign, submission, plugin, inputData) {
        // Check if text has changed.
        if (typeof plugin.rteInitialText != 'undefined') {
            // We have the initial text from the rich text editor, compare it with the new text.
            return plugin.rteInitialText != inputData.onlinetext_editor_text;
        } else {
            // Not using rich text editor or weren't able to get its initial text. Get it from plugin.
            var initialText = plugin.editorfields && plugin.editorfields[0] ? plugin.editorfields[0].text : '',
                newText = getTextToSubmit(plugin, inputData);

            return initialText != newText;
        }
    };

    /**
     * Get the text to submit.
     *
     * @param  {Object} plugin    Plugin.
     * @param  {Object} inputData Data entered in the submission form.
     * @return {String}           Text to submit.
     */
    function getTextToSubmit(plugin, inputData) {
        var text = inputData.onlinetext_editor_text,
            files = plugin.fileareas && plugin.fileareas[0] ? plugin.fileareas[0].files : [];

        return $mmText.restorePluginfileUrls(text, files);
    }

    return self;
})

.run(function($mmAddonManager) {
    // Use addon manager to inject $mmaModAssignSubmissionDelegate. This is to provide an example for remote addons,
    // since they cannot assume that the quiz addon will be packaged in custom apps.
    var $mmaModAssignSubmissionDelegate = $mmAddonManager.get('$mmaModAssignSubmissionDelegate');
    if ($mmaModAssignSubmissionDelegate) {
        $mmaModAssignSubmissionDelegate.registerHandler('mmaModAssignSubmissionOnlinetext', 'onlinetext',
                                '$mmaModAssignSubmissionOnlinetextHandler');
    }
});
