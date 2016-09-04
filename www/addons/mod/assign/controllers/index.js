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
 * Assign index controller.
 *
 * @module mm.addons.mod_assign
 * @ngdoc controller
 * @name mmaModAssignIndexCtrl
 */
.controller('mmaModAssignIndexCtrl', function($scope, $stateParams, $mmaModAssign, $mmUtil, $translate, mmaModAssignComponent, $q,
        $state, $ionicPlatform, mmaModAssignSubmissionInvalidatedEvent, $mmEvents, $mmSite, mmaModAssignSubmissionSavedEvent,
        mmaModAssignSubmittedForGradingEvent, $mmCourse) {
    var module = $stateParams.module || {},
        courseId = $stateParams.courseid,
        siteId = $mmSite.getId(),
        userId = $mmSite.getUserId();

    $scope.title = module.name;
    $scope.description = module.description;
    $scope.assignComponent = mmaModAssignComponent;
    $scope.moduleUrl = module.url;
    $scope.courseid = courseId;
    $scope.moduleid = module.id;
    $scope.refreshIcon = 'spinner';

    // Check if submit through app is supported.
    $mmaModAssign.isSaveAndSubmitSupported().then(function(enabled) {
        $scope.submitSupported = enabled;
    });

    $scope.gotoSubmission = function(submit, blind) {
        if ($ionicPlatform.isTablet()) {
            // Show split view on tablet.
            $state.go('site.mod_assign-submission-list', {sid: submit, courseid: courseId, moduleid: module.id,
                modulename: module.name});
        } else {
            $state.go('site.mod_assign-submission', {submitid: submit, blindid: blind, courseid: courseId, moduleid: module.id});
        }
    };

    function fetchAssignment() {
        // Get assignment data.
        return $mmaModAssign.getAssignment(courseId, module.id).then(function(assign) {
            $scope.title = assign.name || $scope.title;
            $scope.description = assign.intro || $scope.description;
            $scope.assign = assign;
            $scope.haveAllParticipants = false;

            // Get assignment submissions.
            return $mmaModAssign.getSubmissions(assign.id).then(function(data) {
                var promises = [],
                    time = parseInt(Date.now() / 1000);

                $scope.canviewsubmissions = data.canviewsubmissions;
                if (data.canviewsubmissions) {
                    // We want to show the user data on each submission.
                    var blindMarking = assign.blindmarking && !assign.revealidentities,
                        participants = false;

                    promises.push($mmaModAssign.getSubmissionStatus(assign.id).then(function(response) {
                        $scope.summary = response.gradingsummary;
                    }).catch(function() {
                        // Fail silently (WS is not available, fallback).
                        return $q.when();
                    }));

                    if (assign.duedate > 0) {
                        if (assign.duedate - time <= 0) {
                            $scope.timeRemaining = $translate.instant('mma.mod_assign.assignmentisdue');
                        } else {
                            $scope.timeRemaining = $mmUtil.formatDuration(assign.duedate - time, 3);
                            if (assign.cutoffdate) {
                                if (assign.cutoffdate > time) {
                                    $scope.lateSubmissions = $translate.instant('mma.mod_assign.latesubmissionsaccepted',
                                        {'$a': moment(assign.cutoffdate*1000).format($translate.instant('mm.core.dfmediumdate'))});
                                } else {
                                    $scope.lateSubmissions = $translate.instant('mma.mod_assign.nomoresubmissionsaccepted');
                                }
                            }
                        }
                    }

                    promises.push($mmaModAssign.listParticipants(assign.id).then(function(p) {
                        participants = p;
                        $scope.haveAllParticipants = true;
                    }).catch(function() {
                        // Silently fail!
                        return $q.when();
                    }).finally(function() {
                        return $mmaModAssign.getSubmissionsUserData(data.submissions, courseId, assign.id, blindMarking,
                                participants).then(function(submissions) {
                            angular.forEach(submissions, function(submission) {
                                submission.statusTranslated = $translate.instant('mma.mod_assign.submissionstatus_' +
                                    submission.status);
                                submission.statusClass = $mmaModAssign.getSubmissionStatusClass(submission.status);
                            });
                            $scope.submissions = submissions;
                        });
                    }));

                    return $q.all(promises);
                }
            });
        }).catch(function(message) {
            if (message) {
                $mmUtil.showErrorModal(message);
            } else {
                $mmUtil.showErrorModal('Error getting assigment data.');
            }
            return $q.reject();
        });
    }

    // Convenience function to refresh all the data.
    function refreshAllData() {
        var promises = [$mmaModAssign.invalidateAssignmentData(courseId)];
        if ($scope.assign) {
            promises.push($mmaModAssign.invalidateAllSubmissionData($scope.assign.id));
            promises.push($mmaModAssign.invalidateAssignmentUserMappingsData($scope.assign.id));
            promises.push($mmaModAssign.invalidateListParticipantsData($scope.assign.id));
        }

        return $q.all(promises).finally(function() {
            $scope.$broadcast(mmaModAssignSubmissionInvalidatedEvent);
            return fetchAssignment();
        });
    }

    fetchAssignment().then(function() {
        if (!$scope.canviewsubmissions) {
            $mmaModAssign.logSubmissionView($scope.assign.id).catch(function() {
                // Fail silently for Moodle < 3.1.
            });
        } else {
            $mmaModAssign.logGradingView($scope.assign.id).catch(function() {
                // Fail silently for Moodle < 3.0.
            });
        }
    }).finally(function() {
        $scope.assignmentLoaded = true;
        $scope.refreshIcon = 'ion-refresh';
    });

    // Context Menu Description action.
    $scope.expandDescription = function() {
        if ($scope.assign.id && ($scope.description || $scope.assign.introattachments)) {
            // Open a new state with the interpolated contents.
            $state.go('site.mod_assign-description', {
                assignid: $scope.assign.id,
                description: $scope.description,
                files: $scope.assign.introattachments
            });
        }
    };

    $scope.refreshAssignment = function() {
        if ($scope.assignmentLoaded) {
            $scope.refreshIcon = 'spinner';
            refreshAllData().finally(function() {
                $scope.refreshIcon = 'ion-refresh';
                $scope.$broadcast('scroll.refreshComplete');
            });
        }
    };

    // Listen for submission saved event to refresh data.
    var obsSaved = $mmEvents.on(mmaModAssignSubmissionSavedEvent, function(data) {
        if ($scope.assign && data.assignmentId == $scope.assign.id && data.siteId == siteId && data.userId == userId) {
            // Assignment submission saved, refresh data.
            $scope.refreshIcon = 'spinner';
            $scope.assignmentLoaded = false;
            refreshAllData().finally(function() {
                $scope.refreshIcon = 'ion-refresh';
                $scope.assignmentLoaded = true;
            });
        }
    });

    // Listen for submitted for grading event to refresh data.
    var obsSubmitted = $mmEvents.on(mmaModAssignSubmittedForGradingEvent, function(data) {
        if ($scope.assign && data.assignmentId == $scope.assign.id && data.siteId == siteId && data.userId == userId) {
            // Assignment submitted, check completion.
            $mmCourse.checkModuleCompletion(courseId, module.completionstatus);
        }
    });

    $scope.$on('$destroy', function() {
        if (obsSaved && obsSaved.off) {
            obsSaved.off();
        }
        if (obsSubmitted && obsSubmitted.off) {
            obsSubmitted.off();
        }
    });
});
